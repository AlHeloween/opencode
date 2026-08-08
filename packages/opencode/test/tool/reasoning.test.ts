import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { ReasoningEnterTool, ReasoningExitTool } from "@/tool/reasoning"
import * as Tool from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Provider.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    AppFileSystem.defaultLayer,
  ),
)

afterEach(async () => {
  await Instance.disposeAll()
})

function context(sessionID: SessionID, messageID: MessageID, agentInfo?: Agent.Info) {
  return {
    sessionID,
    messageID,
    agent: agentInfo?.name ?? "build",
    agentInfo,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  } satisfies Tool.Context
}

describe("tool.reasoning", () => {
  it.live("orchestrator transitions persist reasoning then build agents", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build")
        const orchestrator = yield* agents.get("orchestrator")
        expect(build).toBeDefined()
        expect(orchestrator).toBeDefined()
        const chat = yield* sessions.create({})
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: chat.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        const enter = yield* (yield* ReasoningEnterTool).init()
        const exit = yield* (yield* ReasoningExitTool).init()
        const deniedEnter = yield* Effect.exit(enter.execute({}, context(chat.id, user.id, build)))
        const deniedExit = yield* Effect.exit(exit.execute({}, context(chat.id, user.id, build)))
        const spoofedEnter = yield* Effect.exit(
          enter.execute({}, context(chat.id, user.id, { ...orchestrator!, native: false })),
        )
        expect(Exit.isFailure(deniedEnter)).toBe(true)
        expect(Exit.isFailure(deniedExit)).toBe(true)
        expect(Exit.isFailure(spoofedEnter)).toBe(true)
        expect(yield* sessions.messages({ sessionID: chat.id })).toHaveLength(1)
        yield* enter.execute({}, context(chat.id, user.id, orchestrator))
        expect((yield* sessions.messages({ sessionID: chat.id })).at(-1)?.info.agent).toBe("reasoning_mode")
        yield* exit.execute({}, context(chat.id, user.id, orchestrator))
        expect((yield* sessions.messages({ sessionID: chat.id })).at(-1)?.info.agent).toBe("build_mode")
      }),
    ),
  )
})
