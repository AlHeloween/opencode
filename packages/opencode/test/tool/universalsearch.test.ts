import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { resolveSearchSource, UniversalSearchTool } from "@/tool/universalsearch"
import * as Tool from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

setDefaultTimeout(30_000)

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

type AskInput = Parameters<Tool.Context["ask"]>[0]

function context(
  sessionID: SessionID,
  messageID: MessageID,
  agentInfo: Agent.Info | undefined,
  ask: (req: AskInput) => Effect.Effect<void>,
) {
  return {
    sessionID,
    messageID,
    agent: agentInfo?.name ?? "build",
    agentInfo,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask,
  } satisfies Tool.Context
}

describe("tool.universalsearch", () => {
  test("omitted source defaults to web", () => {
    expect(resolveSearchSource({})).toBe("web")
    expect(resolveSearchSource({ source: "code" })).toBe("code")
    expect(resolveSearchSource({ source: "agent" })).toBe("agent")
  })

  // The web-only executor gate used to refuse researcher_agent before the
  // permission stage. Reaching `ask` with source "code"/"hybrid"/"agent" proves
  // the gate is gone; dying inside ask keeps the test off the network.
  for (const source of ["code", "hybrid", "agent"] as const) {
    it.live(`researcher_agent with source "${source}" is no longer refused`, () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const agents = yield* Agent.Service
          const researcher = yield* agents.get("researcher_agent")
          expect(researcher).toBeDefined()
          const chat = yield* sessions.create({})
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: chat.id,
            agent: "researcher_agent",
            model: ref,
            time: { created: Date.now() },
          })

          const search = yield* (yield* UniversalSearchTool).init()
          const asks: AskInput[] = []
          const outcome = yield* Effect.exit(
            search.execute(
              { query: "kv cache", source },
              context(chat.id, user.id, researcher, (req) => {
                asks.push(req)
                return Effect.die(new Permission.RejectedError())
              }),
            ),
          )

          expect(Exit.isFailure(outcome)).toBe(true)
          expect(asks.map((req) => req.permission)).toEqual(["universalsearch"])
          expect(asks[0]?.metadata?.["source"]).toBe(source)
        }),
      ),
    )
  }
})
