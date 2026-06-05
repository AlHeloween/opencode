import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Add session usage tracking columns (cost, tokens).
 * Ported from upstream 20260510033149_session_usage.
 */
const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260601000001_session_usage_tracking",

  up(db) {
    const sqlite = db.$client

    // Add new columns with IF NOT EXISTS guard
    for (const col of [
      "ALTER TABLE session ADD COLUMN cost integer NOT NULL DEFAULT 0",
      "ALTER TABLE session ADD COLUMN tokens_input integer NOT NULL DEFAULT 0",
      "ALTER TABLE session ADD COLUMN tokens_output integer NOT NULL DEFAULT 0",
      "ALTER TABLE session ADD COLUMN tokens_reasoning integer NOT NULL DEFAULT 0",
      "ALTER TABLE session ADD COLUMN tokens_cache_read integer NOT NULL DEFAULT 0",
      "ALTER TABLE session ADD COLUMN tokens_cache_write integer NOT NULL DEFAULT 0",
    ]) {
      try {
        sqlite.exec(col)
      } catch (err) {
        log.debug("column already exists or ALTER TABLE failed", { col, error: String(err) })
      }
    }
  },
}

export default migration
