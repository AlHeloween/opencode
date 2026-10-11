import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { PlanEnterTool, PlanExitTool } from "@/tool/plan"
import * as Tool from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

setDefaultTimeout(30_000)

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

// No Question layer is provided on purpose: mode transitions must run through
// the permission system (ctx.ask), never through a user dialog. If a Question
// dependency returns to tool/plan.ts, `(yield* PlanEnterTool)` dies here.
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

const recordingAsk = (asks: AskInput[]) => (req: AskInput) => {
  asks.push(req)
  return Effect.void
}

describe("tool.plan", () => {
  it.live("planenter is permission-gated — no dialog — and switches to plan_mode", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build_mode")
        const chat = yield* sessions.create({})
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: chat.id,
          agent: "build_mode",
          model: ref,
          time: { created: Date.now() },
        })

        const enter = yield* (yield* PlanEnterTool).init()
        const asks: AskInput[] = []
        yield* enter.execute({}, context(chat.id, user.id, build, recordingAsk(asks)))

        expect(asks.map((req) => req.permission)).toEqual(["planenter"])
        expect(asks[0]?.patterns).toEqual(["*"])
        expect((yield* sessions.messages({ sessionID: chat.id })).at(-1)?.info.agent).toBe("plan_mode")
      }),
    ),
  )

  it.live("planexit is permission-gated — no dialog — and switches to build_mode", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const plan = yield* agents.get("plan_mode")
        const chat = yield* sessions.create({})
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: chat.id,
          agent: "plan_mode",
          model: ref,
          time: { created: Date.now() },
        })

        const exit = yield* (yield* PlanExitTool).init()
        const asks: AskInput[] = []
        yield* exit.execute({}, context(chat.id, user.id, plan, recordingAsk(asks)))

        expect(asks.map((req) => req.permission)).toEqual(["planexit"])
        expect(asks[0]?.patterns).toEqual(["*"])
        expect((yield* sessions.messages({ sessionID: chat.id })).at(-1)?.info.agent).toBe("build_mode")
      }),
    ),
  )

  it.live("a refused permission records no mode switch", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const build = yield* agents.get("build_mode")
        const chat = yield* sessions.create({})
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: chat.id,
          agent: "build_mode",
          model: ref,
          time: { created: Date.now() },
        })

        const enter = yield* (yield* PlanEnterTool).init()
        const refused = yield* Effect.exit(
          enter.execute({}, context(chat.id, user.id, build, () => Effect.die(new Permission.RejectedError()))),
        )

        expect(Exit.isFailure(refused)).toBe(true)
        expect((yield* sessions.messages({ sessionID: chat.id })).at(-1)?.info.agent).toBe("build_mode")
      }),
    ),
  )
})
