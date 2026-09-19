import { Database as BunDatabase } from "bun:sqlite"
import { existsSync } from "fs"

/**
 * A stored part AS IT MUST BE READ IN ORDER TO BE WRITTEN BACK.
 *
 * The identity lives in the `part` table COLUMNS; the JSON holds only the part's own fields. A lookup
 * that selects `data` alone therefore yields a part that looks complete and cannot be written —
 * `session.updatePart` rejects it with "sessionID required but not found" — which is exactly how
 * `recall`'s `keep` silently persisted nothing in every build until a live run caught it (2026-09-19).
 *
 * That is why this lookup exists ONCE and every writer goes through it: two lookups would be two places
 * that must remember to read the columns, and the failure is invisible — the part reads back fine, and
 * only the write is lost.
 */
export type StoredPart = {
  id: string
  sessionID: string
  messageID: string
  /** The part's own JSON exactly as stored — the authority for its fields, not the projected columns. */
  json: Record<string, unknown>
}

export type StoredPartLookup = { ok: true; part: StoredPart } | { ok: false; error: string }

/**
 * Read one part by id, identity included. A plain keyed lookup: every address this system prints
 * (the placeholder's `id=<partID>`) hands over exactly one id, so the way back takes exactly one id.
 */
export function readStoredPart(input: { dbPath: string; id: string }): StoredPartLookup {
  if (!existsSync(input.dbPath)) return { ok: false, error: `database not found at ${input.dbPath}` }
  const db = new BunDatabase(input.dbPath, { readonly: true })
  try {
    const row = db
      .prepare("SELECT id, session_id, message_id, data FROM part WHERE id = ? LIMIT 1")
      .get(input.id) as { id: string; session_id: string; message_id: string; data: string } | undefined
    if (!row) return { ok: false, error: `no part with id ${input.id} in this project` }
    try {
      return {
        ok: true,
        part: {
          id: row.id,
          sessionID: row.session_id,
          messageID: row.message_id,
          json: JSON.parse(row.data) as Record<string, unknown>,
        },
      }
    } catch (error) {
      return { ok: false, error: `part ${input.id} is unreadable: ${String(error)}` }
    }
  } catch (error) {
    return { ok: false, error: `lookup failed: ${String(error)}` }
  } finally {
    db.close()
  }
}
