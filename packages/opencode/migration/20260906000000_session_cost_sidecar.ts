import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260906000000_session_cost_sidecar",

  up(db) {
    const sqlite = db.$client
    // Sidecar (Layer-1 summary) cost ledger. `cost` stays the GRAND TOTAL
    // (main + sidecar — everything keeps summing up); this column holds the
    // sidecar part only, so the TUI can show "$X main / $Y sidecar"
    // (main = total − sidecar). real, not integer: fractional USD.
    try {
      sqlite.exec("ALTER TABLE session ADD COLUMN cost_sidecar real")
    } catch (err) {
      log.debug("cost_sidecar column already exists or ALTER TABLE failed", { error: String(err) })
    }
  },
}

export default migration
