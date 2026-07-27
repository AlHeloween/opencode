import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "@/project/instance"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { ProviderID } from "@/provider/schema"
import { MessageID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { SessionProcessor } from "@/session/processor"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { ProviderTest } from "../fake/provider"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.die("unexpected MCP add"),
    connect: () => Effect.die("unexpected MCP connect"),
    disconnect: () => Effect.die("unexpected MCP disconnect"),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.die("unexpected MCP auth"),
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    callTool: () => Effect.die("unexpected MCP tool execution"),
  }),
)

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    ToolRegistry.defaultLayer,
    Truncate.defaultLayer,
    mcp,
  ),
)

afterEach(async () => {
  await Instance.disposeAll()
})

describe("session.tools", () => {
  it.live("keeps reasoning execution-protected while declaring the canonical provider schema", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const agent = yield* agents.get("reasoning")
        const plan = yield* agents.get("plan")
        const providerAgent = yield* agents.get("build")
        expect(agent).toBeDefined()
        expect(plan).toBeDefined()
        expect(providerAgent).toBeDefined()
        const model = ProviderTest.model({ providerID: ProviderID.make("test") })
        const completed: Array<{ id: string; output: unknown }> = []
        const resolved = yield* SessionTools.resolve({
          agent: agent!,
          providerAgent: providerAgent!,
          model,
          session: { id: SessionID.descending() } as Session.Info,
          processor: {
            message: { id: MessageID.ascending() } as SessionProcessor.Handle["message"],
            updateToolCall: () => Effect.succeed(undefined),
            completeToolCall: (id, output) =>
              Effect.sync(() => {
                completed.push({ id, output })
              }),
          } as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
          bypassAgentCheck: false,
          messages: [],
          promptOps: {
            cancel: () => Effect.void,
            resolvePromptParts: () => Effect.succeed([]),
            prompt: () => Effect.die("unexpected task prompt"),
          },
        })
        expect(Object.keys(resolved)).toSatisfy((names) => names.every((name) => /^[a-z0-9]+$/.test(name)))
        expect(SessionTools.originalName(resolved, "applypatch")).toBe("apply_patch")
        expect(Object.keys(resolved)).toContain("memory")
        expect(Object.keys(resolved)).toContain("read")
        yield* Effect.promise(() => resolved.read!.execute!({} as never, { toolCallId: "call-rejected" } as never))
        expect(completed).toHaveLength(1)
        expect(completed[0]?.id).toBe("call-rejected")
        expect(completed[0]?.output).toMatchObject({ output: expect.stringContaining("unavailable in reasoning mode") })

        const planResolved = yield* SessionTools.resolve({
          agent: plan!,
          providerAgent: providerAgent!,
          model,
          session: { id: SessionID.descending() } as Session.Info,
          processor: {
            message: { id: MessageID.ascending() } as SessionProcessor.Handle["message"],
            updateToolCall: () => Effect.succeed(undefined),
            completeToolCall: (id, output) =>
              Effect.sync(() => {
                completed.push({ id, output })
              }),
          } as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
          bypassAgentCheck: false,
          messages: [],
          promptOps: {
            cancel: () => Effect.void,
            resolvePromptParts: () => Effect.succeed([]),
            prompt: () => Effect.die("unexpected task prompt"),
          },
        })
        const planEdit = planResolved.applypatch ?? planResolved.write ?? planResolved.edit
        expect(planEdit).toBeDefined()
        yield* Effect.promise(() => planEdit!.execute!({} as never, { toolCallId: "call-plan-rejected" } as never))
        yield* Effect.promise(() => resolved.memory!.execute!({ action: "read" }, { toolCallId: "call-memory" } as never))
        expect(completed).toHaveLength(3)
        expect(completed[1]?.output).toMatchObject({ output: expect.stringContaining("unavailable in plan mode") })
        expect(completed[2]?.output).toMatchObject({ title: "Memory (empty)" })
      }),
    ),
    { timeout: 20_000 },
  )
})
