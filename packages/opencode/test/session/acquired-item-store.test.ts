import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Session } from "../../src/session/session"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { use as projectDb } from "@/storage/project-db"
import { PartID } from "@/session/schema"
import { ID as SessionEntryID } from "@/v2/session-entry"
import { acquiredItem, type Turn } from "@/session/acquired-item"
import { acquire, currentTurn, listAcquired, releaseAll, releaseItem, tdaHeaderFor } from "@/session/acquired-item-store"
import { isWithheld, parseTdaHeader } from "@/provider/gateway/tda"

/**
 * T3's persistence half, and the ONE oracle that can catch its most likely defect.
 *
 * A table here is described TWICE — the `CREATE TABLE IF NOT EXISTS` DDL that runs idempotently at open
 * (so an existing DB self-heals) and the drizzle declaration that gives typed queries — and nothing
 * else in the repository compares the two. So the first test reads the ARTIFACT back with
 * `PRAGMA table_info`, which is the write-path rule applied to a schema: inspect what was created, not
 * what was written down.
 *
 * The rest pins the lifecycle AT THE STORE, where it is now a row rather than a value: a held item
 * survives its span, an expired one is withheld, a release withholds at once, and no state lives in
 * memory — every call re-reads, which is what makes the span survive a restart.
 */

const env = Layer.mergeAll(Session.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

/** Byte-exact opening of a real `image/webp` payload, as the other TDA suites use. */
const WEBP =
  "UklGRqgqAABXRUJQVlA4IJwqAADwmwCdASqFAQsBPm00lkgkIqIhJFF7CIANiWdu/HyZUcADOxRlfv2b9L0UNjYR7+OyN6Cv7j6aPQV8xfm4f9T1Uf2vprfUg/cX2AP2q60z/B5Kh4e/pf41eZX83/sv5H+d/4z8p/b/7R+292P+0ft5/"
const IMAGE_URL = `data:image/webp;base64,${WEBP}`
const OTHER_URL = "data:image/webp;base64,UklGRiAAAABXRUJQVlA4IBQAAACwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA="

describe("the acquisition store", () => {
  it.live("the DDL and the drizzle declaration describe the SAME table", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sid = (yield* session.create({})).id
        const columns = projectDb((db) => db.all<{ name: string }>(sql`PRAGMA table_info('acquired_item')`))
        expect(columns.map((column) => column.name).sort()).toEqual(
          [
            "digest",
            "expires_at_turn",
            "id",
            "kind",
            "reader",
            "reason",
            "released",
            "session_id",
            "time_created",
            "time_updated",
          ].sort(),
        )
      }),
    ),
  )

  it.live("held → withheld when the span passes; released → withheld at once", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sid = (yield* session.create({})).id
        // The row is written with RAW SQL on purpose: this test's subject is the turn COUNTER's query,
        // and a fixture built through the entry schema's own payload type would tie the assertion to a
        // shape it does not care about — the counter needs `type = 'user'` and nothing else.
        const prompt = (id: string) =>
          projectDb((db) =>
            db.run(
              sql`INSERT INTO "session_entry" (id, session_id, type, time_created, time_updated, data)
                  VALUES (${SessionEntryID.make(id)}, ${sid}, 'user', ${Date.now()}, ${Date.now()}, '{}')`,
            ),
          )

        // Nothing acquired ⇒ nothing to say, and the turn is never even counted.
        expect(tdaHeaderFor(sid)).toBeUndefined()

        prompt("entry-1")
        expect(currentTurn(sid)).toBe(1)
        acquire(
          sid,
          acquiredItem({ id: "prt_1", kind: "image", reason: "screenshot", url: IMAGE_URL, turn: 1, holdTurns: 1, reader: "image_actualizer" }),
        )

        const heldHeader = parseTdaHeader(tdaHeaderFor(sid)!)!
        expect(heldHeader.turn).toBe(1)
        expect(isWithheld(heldHeader.set.held[0]!, heldHeader.turn)).toBe(false)

        prompt("entry-2")
        prompt("entry-3")
        expect(currentTurn(sid)).toBe(3)
        const expiredHeader = parseTdaHeader(tdaHeaderFor(sid)!)!
        expect(isWithheld(expiredHeader.set.held[0]!, expiredHeader.turn)).toBe(true)

        // A release withholds at ONCE even though the span still runs: two facts, and the span is not
        // rewritten to express the release.
        acquire(sid, acquiredItem({ id: "prt_2", kind: "image", reason: "other", url: OTHER_URL, turn: 3, holdTurns: 99 }))
        releaseItem(sid, PartID.make("prt_2"))
        const afterRelease = parseTdaHeader(tdaHeaderFor(sid)!)!
        const second = afterRelease.set.held.find((item) => item.id === "prt_2")!
        expect(isWithheld(second, afterRelease.turn)).toBe(true)
        expect(second.expiresAtTurn).toBe(102)

        // The ROW is the truth: every call re-reads, so what a fresh read returns is what was stored —
        // which is also why the span survives a restart rather than restarting with the process.
        expect(listAcquired(sid).map((item) => String(item.id)).sort()).toEqual(["prt_1", "prt_2"])
      }),
    ),
  )

  it.live("a fold releases EVERYTHING at once, including items whose span still runs", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sid = (yield* session.create({})).id
        acquire(sid, acquiredItem({ id: "prt_1", kind: "image", reason: "a", url: IMAGE_URL, turn: 1, holdTurns: 99 }))
        acquire(sid, acquiredItem({ id: "prt_2", kind: "image", reason: "b", url: OTHER_URL, turn: 1, holdTurns: 99 }))

        // Held by span, both of them.
        const before = parseTdaHeader(tdaHeaderFor(sid)!)!
        expect(before.set.held.every((item) => !isWithheld(item, before.turn))).toBe(true)

        // The trigger is the FOLD, not the clock (owner ruling, plan §0.9.1).
        releaseAll(sid)
        const after = parseTdaHeader(tdaHeaderFor(sid)!)!
        expect(after.set.held.every((item) => isWithheld(item, after.turn))).toBe(true)

        // A release, not an erasure: the spans are untouched and the items are still there, which is what
        // lets the model re-acquire them by the id the pointer prints.
        expect(after.set.held.map((item) => item.expiresAtTurn)).toEqual([100, 100])
        expect(listAcquired(sid)).toHaveLength(2)
      }),
    ),
  )

  it.live("re-acquiring the same payload refreshes the item instead of duplicating it", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sid = (yield* session.create({})).id
        acquire(sid, acquiredItem({ id: "prt_a", kind: "image", reason: "first", url: IMAGE_URL, turn: 1, holdTurns: 5 }))
        acquire(sid, acquiredItem({ id: "prt_b", kind: "image", reason: "second", url: IMAGE_URL, turn: 2, holdTurns: 9 }))
        const items = listAcquired(sid)
        // One row for one payload — the unique index is the invariant — and the refresh carries the new
        // span and the new id, because a re-acquisition is the same bytes under a new address.
        expect(items).toHaveLength(1)
        expect(String(items[0]!.id)).toBe("prt_b")
        expect(items[0]!.expiresAtTurn).toBe(11)
      }),
    ),
  )
})
