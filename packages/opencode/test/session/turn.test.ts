import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Session } from "../../src/session/session"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { use as projectDb } from "@/storage/project-db"
import { MessageID } from "@/session/schema"
import { currentTurn } from "@/session/turn"

// Instance + tmpdir + real DDL, like the other session suites: bun's 5 s default turns a loaded machine
// into a red that says nothing about the code.
setDefaultTimeout(20_000)

/**
 * The turn counter, and the one thing it exists to be able to fail at.
 *
 * This counter carries the TTL's span and the acquisition store's expiry — both compare
 * `expires_at_turn < turn` — so a counter that silently returns a constant disables BOTH while every
 * suite stays green. That is exactly what shipped: it counted `session_entry.type = 'user'`, nothing in
 * this build writes that table (0 rows on a live database against 1 577 user messages), and the
 * fixtures wrote the missing rows themselves — the test and the code agreed with each other and neither
 * agreed with the database.
 *
 * Hence two properties, and the second is the regression guard: the counter must RESPOND to what
 * production writes, and it must NOT respond to the dead table.
 */

const env = Layer.mergeAll(Session.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

/** The row PRODUCTION writes: a `message` with its role inside the json `data`. */
const userMessage = (id: string, sessionID: string, role: string) =>
  projectDb((db) =>
    db.run(
      sql`INSERT INTO "message" (id, session_id, time_created, time_updated, data)
          VALUES (${MessageID.make(id)}, ${sessionID}, ${Date.now()}, ${Date.now()}, ${JSON.stringify({ role })})`,
    ),
  )

describe("the turn counter", () => {
  it.live("counts a user message, ignores every other role, and stays per-session", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sid = (yield* session.create({})).id
        const other = (yield* session.create({})).id

        expect(currentTurn(sid)).toBe(0)

        userMessage("msg-user-1", sid, "user")
        expect(currentTurn(sid)).toBe(1)

        // The ROLE is the filter: a counter over every message reads 2 here, and one over `part` rows —
        // a session carries far more parts than prompts — would be wrong by a wide margin.
        userMessage("msg-assistant-1", sid, "assistant")
        expect(currentTurn(sid)).toBe(1)

        // A span is a session's own span, so another session cannot advance this one.
        userMessage("msg-user-other", other, "user")
        expect(currentTurn(sid)).toBe(1)
        expect(currentTurn(other)).toBe(1)

        userMessage("msg-user-2", sid, "user")
        expect(currentTurn(sid)).toBe(2)
      }),
    ),
  )

  it.live("the dead session_entry table cannot move it — the source of truth is the message history", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const sid = (yield* session.create({})).id

        // Writing the row the OLD counter read must change nothing. This assertion is the defect itself:
        // if it ever passes with `session_entry` as the source, the counter is dead again.
        projectDb((db) =>
          db.run(
            sql`INSERT INTO "session_entry" (id, session_id, type, time_created, time_updated, data)
                VALUES ('entry-1', ${sid}, 'user', ${Date.now()}, ${Date.now()}, '{}')`,
          ),
        )
        expect(currentTurn(sid)).toBe(0)

        // …while the row production actually writes moves it.
        userMessage("msg-user-real", sid, "user")
        expect(currentTurn(sid)).toBe(1)
      }),
    ),
  )
})
