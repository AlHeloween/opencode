import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260817000000_cache_state_statistics",

  up(db) {
    const sqlite = db.$client
    for (const col of [
      "ALTER TABLE session ADD COLUMN cache_hit_steps integer",
      "ALTER TABLE session ADD COLUMN cache_miss_steps integer",
      "ALTER TABLE session ADD COLUMN cache_unknown_steps integer",
      "ALTER TABLE session ADD COLUMN cache_state_observed integer",
    ]) {
      try {
        sqlite.exec(col)
      } catch (err) {
        log.debug("cache-state column already exists or ALTER TABLE failed", { col, error: String(err) })
      }
    }
  },
}

export default migration
