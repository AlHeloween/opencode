import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Add indexed type/tool_name/status columns to the part table.
 * Extracted from JSON data for query pushdown — avoids parsing
 * JSON on every hydration cycle.
 *
 * Plan: B5 hybrid part storage (2026-07-29-hybrid-part-storage.md)
 */
const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260730_add_part_type_columns",

  up(db) {
    const sqlite = db.$client

    for (const col of [
      "ALTER TABLE part ADD COLUMN type text NOT NULL DEFAULT 'unknown'",
      "ALTER TABLE part ADD COLUMN tool_name text",
      "ALTER TABLE part ADD COLUMN status text",
    ]) {
      try {
        sqlite.exec(col)
      } catch (err) {
        log.debug("column already exists or ALTER TABLE failed", { col, error: String(err) })
      }
    }

    for (const idx of [
      "CREATE INDEX IF NOT EXISTS part_type_idx ON part (type)",
      "CREATE INDEX IF NOT EXISTS part_tool_status_idx ON part (tool_name, status)",
    ]) {
      try {
        sqlite.exec(idx)
      } catch (err) {
        log.debug("index creation failed", { idx, error: String(err) })
      }
    }
  },
}

export default migration
