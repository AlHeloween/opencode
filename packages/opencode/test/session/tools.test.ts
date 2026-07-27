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
    tools: () => Effect.die("unexpected MCP tool discovery"),
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
  it.live("resolves only native memory for protected reasoning", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const agent = yield* (yield* Agent.Service).get("reasoning")
        expect(agent).toBeDefined()
        const model = ProviderTest.model({ providerID: ProviderID.make("test") })
        const resolved = yield* SessionTools.resolve({
          agent: agent!,
          model,
          session: { id: SessionID.descending() } as Session.Info,
          processor: {
            message: { id: MessageID.ascending() } as SessionProcessor.Handle["message"],
            updateToolCall: () => Effect.succeed(undefined),
            completeToolCall: () => Effect.void,
          } as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
          bypassAgentCheck: false,
          messages: [],
          promptOps: {
            cancel: () => Effect.void,
            resolvePromptParts: () => Effect.succeed([]),
            prompt: () => Effect.die("unexpected task prompt"),
          },
        })
        expect(Object.keys(resolved)).toEqual(["memory"])
      }),
    ),
  )
})
