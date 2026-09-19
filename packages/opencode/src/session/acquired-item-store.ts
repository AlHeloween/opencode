import { and, eq, sql } from "drizzle-orm"
import { use as projectDb } from "@/storage/project-db"
import { AcquiredItemTable, SessionEntryTable } from "@/storage/schema-project.sql"
import { PartID, SessionID } from "@/session/schema"
import { type TdaHeld, type TdaKind } from "@/provider/gateway/tda"
import { tdaHeaderValue, type Turn } from "@/session/acquired-item"

/**
 * The acquisition store — the persistence half of T3, and the ONLY writer of the set.
 *
 * The gateway never sees this: it is handed the instruction (plan §0.3). Everything that DECIDES lives
 * in the pure module beside this one; this file stores and transports, and repeats no rule — a rule
 * written twice drifts, and the drift would be invisible (the store would withhold what the gateway
 * still expects to withhold).
 *
 * There is deliberately NO in-memory cache: every call re-reads the table. That is what makes "held for
 * N turns" survive a restart — a set or a counter kept in memory restarts with the process and
 * silently changes what the span means.
 */

export function listAcquired(sessionID: SessionID): TdaHeld[] {
  const rows = projectDb((db) =>
    db.select().from(AcquiredItemTable).where(eq(AcquiredItemTable.session_id, sessionID)).all(),
  )
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as TdaKind,
    reason: row.reason,
    digest: row.digest,
    expiresAtTurn: row.expires_at_turn,
    ...(row.reader === null ? {} : { reader: row.reader }),
    ...(row.released === 0 ? {} : { released: true }),
  }))
}

/**
 * Record an acquisition. Re-acquiring the SAME payload refreshes the item instead of adding a second
 * row: `digest` is what the gateway matches, so two rows for one payload would let the gateway withhold
 * something this side still believes is held. The unique index is the invariant, and the upsert is how
 * the writer honours it rather than tripping over it.
 */
export function acquire(sessionID: SessionID, item: TdaHeld): void {
  const now = Date.now()
  const released = item.released === true ? 1 : 0
  projectDb((db) =>
    db
      .insert(AcquiredItemTable)
      .values({
        id: item.id,
        session_id: sessionID,
        kind: item.kind,
        reason: item.reason,
        reader: item.reader ?? null,
        digest: item.digest,
        expires_at_turn: item.expiresAtTurn,
        released,
        time_created: now,
        time_updated: now,
      })
      .onConflictDoUpdate({
        target: [AcquiredItemTable.session_id, AcquiredItemTable.digest],
        set: {
          id: item.id,
          reason: item.reason,
          reader: item.reader ?? null,
          expires_at_turn: item.expiresAtTurn,
          released,
          time_updated: now,
        },
      })
      .run(),
  )
}

/** The release the tool performs. It withholds at ONCE and leaves the span alone — two facts. */
export function releaseItem(sessionID: SessionID, id: PartID): void {
  projectDb((db) =>
    db
      .update(AcquiredItemTable)
      .set({ released: 1, time_updated: Date.now() })
      .where(and(eq(AcquiredItemTable.session_id, sessionID), eq(AcquiredItemTable.id, id)))
      .run(),
  )
}

/**
 * Release EVERY item of a session at once.
 *
 * Compaction is a HARD release trigger (owner ruling, plan §0.9.1): held content must not be carried
 * across a fold. The fold is where the window is rebuilt, and an item that survived it would keep
 * paying for attention it no longer has — while the pointer standing where its payload was is exactly
 * what the model needs to decide. The release is therefore not a loss for the runtime to repair: it is
 * a decision handed over, and the expected answer («приведет дела в порядок, сделает компакт и
 * захватит файлы снова») is the model making it.
 */
export function releaseAll(sessionID: SessionID): void {
  projectDb((db) =>
    db
      .update(AcquiredItemTable)
      .set({ released: 1, time_updated: Date.now() })
      .where(eq(AcquiredItemTable.session_id, sessionID))
      .run(),
  )
}

/**
 * A turn is a USER PROMPT, counted from the session's own event log — `session_entry.type = 'user'`,
 * indexed by `(session_id, type)`. Derived, so it cannot drift, and it survives a restart for free.
 */
export function currentTurn(sessionID: SessionID): Turn {
  const row = projectDb((db) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(SessionEntryTable)
      .where(and(eq(SessionEntryTable.session_id, sessionID), eq(SessionEntryTable.type, "user")))
      .get(),
  )
  return row?.n ?? 0
}

/**
 * The ONE entry point the send site calls.
 *
 * Items are read FIRST and the turn is counted only when there ARE items: an empty table is the
 * overwhelmingly common case, and this sits on the hot path of every request. That ordering is why the
 * feature costs nothing at all until something is actually acquired — the same property the transform
 * keeps on the other side of the wire.
 */
export function tdaHeaderFor(sessionID: string): string | undefined {
  // The transport layer holds a session id as a PLAIN STRING, so the read path accepts one and brands it
  // here — once, at the boundary — instead of making every call site remember the brand. The WRITE path
  // stays branded on purpose: a wrongly-shaped id there would write a row nobody could ever find again.
  const sid = SessionID.make(sessionID)
  const items = listAcquired(sid)
  if (items.length === 0) return undefined
  return tdaHeaderValue(items, currentTurn(sid))
}
