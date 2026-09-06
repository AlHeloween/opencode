import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260906000001_session_cost_sidecar_backfill",

  up(db) {
    // 20260906000000 added cost_sidecar without NOT NULL DEFAULT — existing
    // rows hold NULL and `cost_sidecar + X` propagates NULL (sidecar cost
    // silently dropped). Normalize to 0; the writer also coalesces.
    try {
      db.$client.exec("UPDATE session SET cost_sidecar = 0 WHERE cost_sidecar IS NULL")
    } catch (err) {
      log.debug("cost_sidecar backfill failed", { error: String(err) })
    }
  },
}

export default migration
