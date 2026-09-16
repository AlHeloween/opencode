/**
 * Forking from a point in history must hand the new session a usable content
 * window — the previous m* plus the raw tail from there to the fork point.
 *
 * Nothing assembles that window inside `fork`, and nothing needs to: the m*
 * builder already walks compacted rows, so it produces exactly that shape
 * PROVIDED the fork copies true history. `fork` used to copy
 * `messages({ sessionID })`, whose defaults are `visibleOnly: true` and
 * `limit: 500` over a DESC-sorted page — the newest 500 VISIBLE rows. Both
 * defaults broke it:
 *
 * - Depth: forking at a message older than those 500 broke the copy loop on
 *   its first iteration and produced an EMPTY fork.
 * - Window: a summary is written after the messages it folds, so its id is
 *   HIGHER. Forking inside a folded region lost both halves — the covering m*
 *   sat above the fork point and was cut by the loop's break, the rows it
 *   folded were `compacted` and cut by `visibleOnly` — leaving the region right
 *   before the fork point represented by nothing.
 */
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import * as Log from "@opencode-ai/core/util/log"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init()

const it = testEffect(Layer.mergeAll(Session.defaultLayer, CrossSpawnSpawner.defaultLayer))

const userSaying = Effect.fn("test.userSaying")(function* (
  session: Session.Interface,
  sessionID: SessionID,
  text: string,
  opts?: { compacted?: boolean },
) {
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
    time: { created: Date.now() },
    ...(opts?.compacted ? { compacted: true } : {}),
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID,
    type: "text",
    text,
  })
  return user
})

describe("fork window", () => {
  it.live(
    "a fork inside a folded region carries the folded rows, not just the visible ones",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const origin = yield* session.create({})

        // Two rows already folded into an m*, then a live row. Forking at the
        // live row must carry BOTH folded rows: they are the raw tail the
        // window is assembled from, and `visibleOnly` cut them.
        const folded1 = yield* userSaying(session, origin.id, "folded one", { compacted: true })
        const folded2 = yield* userSaying(session, origin.id, "folded two", { compacted: true })
        const live = yield* userSaying(session, origin.id, "live row")

        const forked = yield* session.fork({ sessionID: origin.id, messageID: live.id })
        expect(forked.id).not.toBe(origin.id)

        const copied = yield* session.messages({ sessionID: forked.id, visibleOnly: false, limit: 10_000 })
        const texts = copied.flatMap((m) =>
          m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text),
        )
        expect(texts).toEqual(["folded one", "folded two"])
        // The fork point itself is excluded — the copy is strictly below it.
        expect(texts).not.toContain("live row")
        // And the flags ride along, so the fork reproduces the structure rather
        // than a flattened copy: the m* builder needs them to tell the folded
        // tail from live rows.
        expect(copied.map((m) => Boolean(m.info.compacted))).toEqual([true, true])
        expect(folded1.id).not.toBe(folded2.id)
      }),
    ),
    30_000,
  )

  it.live(
    "a fork from deep history is not empty",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const origin = yield* session.create({})

        // Past the old 500-row page. The fork point is row 3, which the newest
        // 500 window did not even contain — the loop broke immediately and the
        // fork came out empty.
        const first = yield* userSaying(session, origin.id, "row 1")
        yield* userSaying(session, origin.id, "row 2")
        const forkAt = yield* userSaying(session, origin.id, "row 3")
        for (let i = 4; i <= 520; i++) yield* userSaying(session, origin.id, `row ${i}`)

        const forked = yield* session.fork({ sessionID: origin.id, messageID: forkAt.id })
        const copied = yield* session.messages({ sessionID: forked.id, visibleOnly: false, limit: 10_000 })
        expect(copied.length).toBe(2)
        const texts = copied.flatMap((m) =>
          m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text),
        )
        expect(texts).toEqual(["row 1", "row 2"])
        expect(first.id).toBeTruthy()
      }),
    ),
    120_000,
  )
})
