/**
 * Two invariants of the user-message revert anchor.
 *
 * 1. The revert target is ALWAYS the last user message at or before the thing
 *    you pointed at. Snapshots are now taken once per turn precisely because
 *    this is the only granularity that can ever be restored.
 * 2. A missing Fossil snapshot must NOT abort the revert. The file-level
 *    restore is skipped; the message-level revert still lands, or the UI has
 *    no undoable state to show and the tail is stranded.
 */
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { SessionRevert } from "../../src/session/revert"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionCompaction } from "../../src/session/compaction"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  SnapshotFossil.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionCompaction.defaultLayer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Session.defaultLayer),
  ),
)
const it = testEffect(env)
const MODEL = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") }

describe("revert anchors on the user message", () => {
  it.live(
    "pointing at an assistant turn folds the anchor back to the user message that asked for it",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const sid = (yield* session.create({})).id

        const mkUser = (text: string) =>
          Effect.gen(function* () {
            const m = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: sid,
              agent: "build",
              model: MODEL,
              time: { created: Date.now() },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: m.id,
              sessionID: sid,
              type: "text",
              text,
            })
            return m
          })

        const mkAssistant = (parentID: ReturnType<typeof MessageID.ascending>, text: string) =>
          Effect.gen(function* () {
            const m = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              sessionID: sid,
              parentID,
              agent: "build",
              mode: "primary",
              providerID: MODEL.providerID,
              modelID: MODEL.modelID,
              path: { cwd: process.cwd(), root: process.cwd() },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: Date.now() },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: m.id,
              sessionID: sid,
              type: "text",
              text,
            })
            return m
          })

        const user1 = yield* mkUser("first ask")
        yield* mkAssistant(user1.id, "first answer")
        const user2 = yield* mkUser("second ask")
        const assistant2 = yield* mkAssistant(user2.id, "second answer")

        // Point at the ASSISTANT turn. There is no mid-turn state to return to,
        // so the anchor must fold back to the user message that started it.
        yield* revert.revert({ sessionID: sid, messageID: assistant2.id })

        const state = yield* session.get(sid)
        expect(state.revert?.messageID).toBe(user2.id)
        expect(state.revert?.messageID).not.toBe(assistant2.id)
        expect(state.revert?.messageID).not.toBe(user1.id)
      }),
    ),
  )

  it.live(
    "a turn with no Fossil snapshot still produces a message-level revert",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const sid = (yield* session.create({})).id

        const mkUser = (text: string) =>
          Effect.gen(function* () {
            const m = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: sid,
              agent: "build",
              model: MODEL,
              time: { created: Date.now() },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: m.id,
              sessionID: sid,
              type: "text",
              text,
            })
            return m
          })

        const mkAssistant = (parentID: ReturnType<typeof MessageID.ascending>, text: string) =>
          Effect.gen(function* () {
            const m = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              sessionID: sid,
              parentID,
              agent: "build",
              mode: "primary",
              providerID: MODEL.providerID,
              modelID: MODEL.modelID,
              path: { cwd: process.cwd(), root: process.cwd() },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: Date.now() },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: m.id,
              sessionID: sid,
              type: "text",
              text,
            })
            return m
          })

        const user1 = yield* mkUser("ask")
        const assistant1 = yield* mkAssistant(user1.id, "answer")

        // No `patch` parts anywhere: this turn touched no files, so nothing was
        // ever snapshotted. The revert must still land on the user message.
        yield* revert.revert({ sessionID: sid, messageID: assistant1.id })

        const state = yield* session.get(sid)
        expect(state.revert).toBeTruthy()
        expect(state.revert?.messageID).toBe(user1.id)
      }),
    ),
  )
})
