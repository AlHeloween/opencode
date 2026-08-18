import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260817000000_cache_state_statistics",

  up(db) {
    const sqlite = db.$client
    // Add hit_rate_is_null flag — single column replacing 4 dead cache_state columns.
    // NULL = never observed, 0 = hit rate available, 1 = hit rate unavailable (KAT/null)
    try {
      sqlite.exec("ALTER TABLE session ADD COLUMN hit_rate_is_null integer")
    } catch (err) {
      log.debug("hit_rate_is_null column already exists or ALTER TABLE failed", { error: String(err) })
    }
    // Drop 4 dead columns (SQLite 3.35+). Safe to fail if columns don't exist yet.
    for (const col of ["cache_hit_steps", "cache_miss_steps", "cache_unknown_steps", "cache_state_observed"]) {
      try {
        sqlite.exec(`ALTER TABLE session DROP COLUMN ${col}`)
      } catch (err) {
        log.debug("cache-state column drop failed (may not exist)", { col, error: String(err) })
      }
    }
  },
}

export default migration
