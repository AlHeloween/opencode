import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260907000000_media_token_calibration",

  up(db) {
    // Per-model media token calibration (2026-09-07, Alexander): the real
    // cost of media (video/images) measured from provider usage responses,
    // stored as a per-model EMA. Media is excluded from the chars/4 text
    // estimate; this table provides the measured price instead.
    try {
      db.$client.exec(`
        CREATE TABLE IF NOT EXISTS media_token_calibration (
          provider_id text NOT NULL,
          model_id text NOT NULL,
          modality text NOT NULL,
          tokens_per_item real NOT NULL,
          observations integer NOT NULL,
          time_updated integer NOT NULL,
          PRIMARY KEY (provider_id, model_id, modality)
        )
      `)
    } catch (err) {
      log.debug("media_token_calibration table already exists or CREATE failed", { error: String(err) })
    }
  },
}

export default migration
