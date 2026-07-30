import { describe, expect, test } from "bun:test"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { tmpdir } from "../fixture/fixture"

const projectRoot = require("path").join(__dirname, "../..")
Log.init()

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function remove(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(id)))
}

function finishStep(input: {
  sessionID: SessionID
  message: MessageV2.Info
  stepFinishPart: MessageV2.StepFinishPart
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.finishStep(input)))
}

describe("Session.finishStep", () => {
  test("batches step-finish part + message update + token accumulation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "finish-step-test" })

        const messageID = MessageID.ascending()
        const msg: MessageV2.Info = {
          id: messageID,
          sessionID: info.id,
          role: "assistant",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info

        const stepFinishPart: MessageV2.StepFinishPart = {
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "step-finish",
          reason: "stop",
          snapshot: undefined,
          tokens: {
            total: 100,
            input: 50,
            output: 30,
            reasoning: 10,
            cache: { read: 5, write: 5 },
          },
          cost: 0.01,
        }

        const tokens = {
          input: 50,
          output: 30,
          reasoning: 10,
          cache: { read: 5, write: 5 },
        }

        // finishStep must not throw
        await expect(
          finishStep({
            sessionID: info.id,
            message: msg,
            stepFinishPart,
            cost: 0.01,
            tokens,
          }),
        ).resolves.toBeUndefined()

        // Verify session was created (no crash = success)
        const retrieved = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.get(info.id)),
        )
        expect(retrieved.id).toBe(info.id)
        expect(retrieved.title).toBe("finish-step-test")

        await remove(info.id)
      },
    })
  })

  test("finishStep propagates token accumulation to session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "token-accum-test" })

        const messageID = MessageID.ascending()
        const msg: MessageV2.Info = {
          id: messageID,
          sessionID: info.id,
          role: "assistant",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info

        const stepFinishPart: MessageV2.StepFinishPart = {
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "step-finish",
          reason: "stop",
          snapshot: undefined,
          tokens: {
            total: 2500,
            input: 1000,
            output: 800,
            reasoning: 300,
            cache: { read: 200, write: 200 },
          },
          cost: 0.05,
        }

        const tokens = {
          input: 1000,
          output: 800,
          reasoning: 300,
          cache: { read: 200, write: 200 },
        }

        await finishStep({
          sessionID: info.id,
          message: msg,
          stepFinishPart,
          cost: 0.05,
          tokens,
        })

        // Retrieve and verify token/cost accumulation
        const retrieved = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.get(info.id)),
        )

        // Tokens are accumulated via sql`tokens_input + N` — they should be non-zero
        expect(retrieved.tokens).toBeDefined()
        expect(retrieved.tokens!.input).toBeGreaterThanOrEqual(1000)
        expect(retrieved.tokens!.output).toBeGreaterThanOrEqual(800)
        expect(retrieved.tokens!.reasoning).toBeGreaterThanOrEqual(300)
        expect(retrieved.tokens!.cache.read).toBeGreaterThanOrEqual(200)
        expect(retrieved.tokens!.cache.write).toBeGreaterThanOrEqual(200)

        // Cost is accumulated via sql`cost + N` — should be >= 0.05
        expect(retrieved.cost).toBeGreaterThanOrEqual(0.05)

        await remove(info.id)
      },
    })
  })

  test("finishStep emits PartUpdated and Updated SyncEvents", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Bus } = await import("../../src/bus")

        const info = await create({ title: "sync-event-test" })
        const messageID = MessageID.ascending()

        let partUpdatedReceived = false
        let messageUpdatedReceived = false

        const unsubPart = Bus.subscribe(MessageV2.Event.PartUpdated, () => {
          partUpdatedReceived = true
        })
        const unsubMsg = Bus.subscribe(MessageV2.Event.Updated, () => {
          messageUpdatedReceived = true
        })

        const msg: MessageV2.Info = {
          id: messageID,
          sessionID: info.id,
          role: "assistant",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info

        const stepFinishPart: MessageV2.StepFinishPart = {
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "step-finish",
          reason: "stop",
          snapshot: undefined,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        }

        await finishStep({
          sessionID: info.id,
          message: msg,
          stepFinishPart,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubPart()
        unsubMsg()

        // Both SyncEvents must have been emitted
        expect(partUpdatedReceived).toBe(true)
        expect(messageUpdatedReceived).toBe(true)

        await remove(info.id)
      },
    })
  })

  test("finishStep handles consecutive calls (multiple steps)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "multi-step-test" })

        const makeStep = () => {
          const messageID = MessageID.ascending()
          return {
            messageID,
            msg: {
              id: messageID,
              sessionID: info.id,
              role: "assistant",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test" },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info,
            part: {
              id: PartID.ascending(),
              messageID,
              sessionID: info.id,
              type: "step-finish" as const,
              reason: "stop" as const,
              snapshot: undefined,
              tokens: { total: 10, input: 5, output: 3, reasoning: 1, cache: { read: 1, write: 0 } },
              cost: 0.001,
            } satisfies MessageV2.StepFinishPart,
            tokens: { input: 5, output: 3, reasoning: 1, cache: { read: 1, write: 0 } as const },
          }
        }

        // Three consecutive finishStep calls
        for (let i = 0; i < 3; i++) {
          const step = makeStep()
          await expect(
            finishStep({
              sessionID: info.id,
              message: step.msg,
              stepFinishPart: step.part,
              cost: 0.001,
              tokens: step.tokens,
            }),
          ).resolves.toBeUndefined()
        }

        // All three should have accumulated tokens
        const retrieved = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.get(info.id)),
        )
        expect(retrieved.tokens!.input).toBeGreaterThanOrEqual(15)
        expect(retrieved.cost).toBeGreaterThanOrEqual(0.003)

        await remove(info.id)
      },
    })
  })
})
