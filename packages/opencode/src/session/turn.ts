import { and, eq, sql } from "drizzle-orm"
import { use as projectDb } from "@/storage/project-db"
import { MessageTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"

/**
 * A turn is a USER PROMPT, DERIVED from the session's own history rather than remembered.
 *
 * A counter kept in memory restarts with the process and silently changes what "held for N turns" means
 * across a restart — the drift this module exists to prevent. Derived, it cannot drift, and it costs one
 * indexed count.
 *
 * The source is `message`, with the ROLE inside its json `data`, because the first version of this
 * counter read `session_entry.type = 'user'` and NOTHING in this build writes that table: it holds zero
 * rows on a live database — measured 2026-09-19 against 15 368 messages, 1 577 of them user turns. A
 * counter pinned at 0 makes every span comparison false, so nothing would ever expire while every suite
 * stayed green, because the fixtures wrote those rows themselves.
 */
export type Turn = number

export function currentTurn(sessionID: SessionID): Turn {
  const row = projectDb((db) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(MessageTable)
      .where(and(eq(MessageTable.session_id, sessionID), sql`json_extract(${MessageTable.data}, '$.role') = 'user'`))
      .get(),
  )
  return row?.n ?? 0
}
