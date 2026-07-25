import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Promote message.compacted to a first-class SQL column so visible loads
 * (filterCompactedEffect / pageCompacted) can skip soft-hidden archive rows
 * without hydrating the entire session lifetime.
 *
 * Backfill from JSON data.compacted (set true by Layer-2 compact soft-hide).
 */
const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260601000002_message_compacted_column",

  up(db) {
    const sqlite = db.$client

    try {
      sqlite.exec("ALTER TABLE message ADD COLUMN compacted integer NOT NULL DEFAULT 0")
    } catch (err) {
      log.debug("message.compacted column already exists or ALTER failed", { error: String(err) })
    }

    try {
      // json_extract returns 1 for true, null when absent — mark soft-hidden rows.
      sqlite.exec(`
        UPDATE message
        SET compacted = 1
        WHERE json_extract(data, '$.compacted') = 1
           OR json_extract(data, '$.compacted') = true
      `)
    } catch (err) {
      log.warn("bug: message.compacted backfill failed", { error: String(err) })
    }

    try {
      sqlite.exec(
        "CREATE INDEX IF NOT EXISTS message_session_compacted_time_id_idx ON message (session_id, compacted, time_created, id)",
      )
    } catch (err) {
      log.debug("message visible index create failed", { error: String(err) })
    }
  },
}

export default migration
