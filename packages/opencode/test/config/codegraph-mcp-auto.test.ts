import { describe, expect, test } from "bun:test"
import path from "path"
import {
  defaultCodegraphMcpConfig,
  injectAutoCodegraphMcp,
  isCodegraphMcpOptOut,
  shouldAutoEnableCodegraphMcp,
} from "../../src/config/codegraph-mcp-auto"

const RUST = path.resolve(import.meta.dir, "../../../../external/codegraph-rust")
const MONO = path.resolve(import.meta.dir, "../../../..")

describe("codegraph-mcp-auto", () => {
  test("opt-out via env", () => {
    expect(isCodegraphMcpOptOut({ OPENCODE_CODEGRAPH_MCP: "0" })).toBe(true)
    expect(isCodegraphMcpOptOut({ OPENCODE_CODEGRAPH_MCP: "false" })).toBe(true)
    expect(isCodegraphMcpOptOut({})).toBe(false)
  })

  test("should auto-enable when .codegraph exists", () => {
    // monorepo and sandbox both typically have indexes in Local_Development
    const env = { ...process.env }
    delete env.OPENCODE_CODEGRAPH_MCP
    const ok = shouldAutoEnableCodegraphMcp(MONO, env) || shouldAutoEnableCodegraphMcp(RUST, env)
    expect(ok).toBe(true)
  })

  test("injects default when mcp.codegraph missing", () => {
    const env = { ...process.env }
    delete env.OPENCODE_CODEGRAPH_MCP
    const { mcp, injected } = injectAutoCodegraphMcp({}, MONO, env)
    if (!shouldAutoEnableCodegraphMcp(MONO, env)) {
      expect(injected).toBe(false)
      return
    }
    expect(injected).toBe(true)
    expect(mcp.codegraph).toBeDefined()
    const cg = mcp.codegraph as { type: string; command: string[]; enabled?: boolean; timeout?: number }
    expect(cg.type).toBe("local")
    expect(cg.command).toEqual(["codegraph", "serve", "--mcp"])
    expect(cg.enabled).toBe(true)
    expect(cg.timeout).toBe(120_000)
  })

  test("does not override existing mcp.codegraph", () => {
    const existing = {
      type: "local" as const,
      command: ["custom-cg", "serve", "--mcp"],
      enabled: true,
    }
    const { mcp, injected } = injectAutoCodegraphMcp({ codegraph: existing }, MONO, {})
    expect(injected).toBe(false)
    expect(mcp.codegraph).toEqual(existing)
  })

  test("respects enabled:false disable", () => {
    const { mcp, injected } = injectAutoCodegraphMcp({ codegraph: { enabled: false } }, MONO, {})
    expect(injected).toBe(false)
    expect(mcp.codegraph).toEqual({ enabled: false })
  })

  test("opt-out skips inject even with index", () => {
    const { injected } = injectAutoCodegraphMcp({}, MONO, { OPENCODE_CODEGRAPH_MCP: "0" })
    expect(injected).toBe(false)
  })

  test("default config shape", () => {
    const d = defaultCodegraphMcpConfig()
    expect(d.type).toBe("local")
    if (d.type === "local") {
      expect(d.environment?.CODEGRAPH_MCP_TOOLS).toContain("explore")
    }
  })
})
