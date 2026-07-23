/**
 * Effect-level tests: CodeGraph MCP client hard-fail vs success.
 * Uses a mock MCP.Service — no real codegraph process required.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { MCP } from "../../src/mcp"
import {
  CODEGRAPH_MCP_SERVER,
  callCodegraphMcpOptionalRuntime,
  exploreChangedFilesMcp,
  mcpTextToSymTag,
} from "../../src/codegraph/mcp-client"

function mcpLayer(callTool: MCP.Interface["callTool"]) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("auth unexpected"),
      authenticate: () => Effect.die("auth unexpected"),
      finishAuth: () => Effect.die("auth unexpected"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
      callTool,
    }),
  )
}

describe("callCodegraphMcpOptionalRuntime", () => {
  test("hard-fails when MCP.Service is absent from runtime", async () => {
    const exit = await Effect.runPromiseExit(callCodegraphMcpOptionalRuntime("explore", { query: "x" }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = String(exit.cause)
      expect(err).toMatch(/MCP\.Service is not available|soft-skip/i)
    }
  })

  test("hard-fails when callTool fails (MCP down)", async () => {
    const layer = mcpLayer(() =>
      Effect.fail(
        new Error(
          'MCP server "codegraph" is not connected. CodeGraph requires a live MCP process.',
        ),
      ),
    )
    const exit = await Effect.runPromiseExit(
      callCodegraphMcpOptionalRuntime("codegraph_explore", { query: "guardCommand" }).pipe(Effect.provide(layer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toMatch(/not connected|live MCP/i)
    }
  })

  test("returns text on successful MCP callTool", async () => {
    const layer = mcpLayer((server, tool, args) => {
      expect(server).toBe(CODEGRAPH_MCP_SERVER)
      expect(tool).toBe("codegraph_explore")
      expect(args?.query).toBe("how does compaction work")
      return Effect.succeed("**Exploration:** compaction.ts\nfunction compact() { ... }")
    })
    const text = await Effect.runPromise(
      callCodegraphMcpOptionalRuntime("explore", { query: "how does compaction work" }).pipe(Effect.provide(layer)),
    )
    expect(text).toContain("Exploration")
    expect(text).toContain("compaction")
  })

  test("normalizes short tool names to codegraph_*", async () => {
    let seen = ""
    const layer = mcpLayer((_s, tool) => {
      seen = tool
      return Effect.succeed("ok")
    })
    await Effect.runPromise(callCodegraphMcpOptionalRuntime("impact", { symbol: "x" }).pipe(Effect.provide(layer)))
    expect(seen).toBe("codegraph_impact")
  })
})

describe("exploreChangedFilesMcp (diff expansion)", () => {
  test("calls codegraph_explore with structural impact query over file list", async () => {
    let captured: { tool: string; args?: Record<string, unknown> } | undefined
    const layer = mcpLayer((server, tool, args) => {
      captured = { tool, args }
      expect(server).toBe(CODEGRAPH_MCP_SERVER)
      return Effect.succeed(
        [
          "**Exploration: Structural impact**",
          "packages/opencode/src/session/compaction.ts",
          "Found 12 symbols",
          "callers: Session.compact",
        ].join("\n"),
      )
    })

    const files = [
      "packages/opencode/src/session/compaction.ts",
      "packages/opencode/src/tool/bash.ts",
    ]
    const text = await Effect.runPromise(
      exploreChangedFilesMcp("/worktree", files).pipe(Effect.provide(layer)),
    )

    expect(captured?.tool).toBe("codegraph_explore")
    expect(captured?.args?.projectPath).toBe("/worktree")
    expect(String(captured?.args?.query)).toContain("Structural impact")
    expect(String(captured?.args?.query)).toContain("compaction.ts")
    expect(String(captured?.args?.query)).toContain("bash.ts")
    expect(text).toContain("Found 12 symbols")

    // Tag path used by fossil track
    const tag = mcpTextToSymTag(text)
    expect(tag.startsWith("MCP:")).toBe(true)
    expect(tag).toContain("Exploration")
  })

  test("hard-fails on empty MCP body when tagging", async () => {
    const layer = mcpLayer(() => Effect.succeed("   \n  "))
    const text = await Effect.runPromise(
      exploreChangedFilesMcp("/w", ["a.ts"]).pipe(Effect.provide(layer)),
    )
    // explore returns whitespace; tag builder must refuse
    expect(() => mcpTextToSymTag(text)).toThrow(/empty/)
  })

  test("hard-fails when MCP callTool fails during diff expansion", async () => {
    const layer = mcpLayer(() => Effect.fail(new Error("MCP down — reindex ~20m not a fallback")))
    const exit = await Effect.runPromiseExit(
      exploreChangedFilesMcp("/w", ["packages/opencode/src/foo.ts"]).pipe(Effect.provide(layer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String((exit as Exit.Failure<Error>).cause ?? exit)).toMatch(/MCP down|20m|fail/i)
  })
})
