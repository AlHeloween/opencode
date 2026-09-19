import type { DatabaseMigration } from "@/storage/migration"
import * as Log from "@opencode-ai/core/util/log"

/**
 * The part's declared lifetime — plus the tidying that belongs in the same pass.
 *
 * A `ttl` is what lets a piece of content leave the REQUEST while staying in HISTORY: a source read for
 * one question and released, a batch of GUI snapshots reported and dropped. It follows the `compacted`
 * precedent instead of inventing a shape — a flag promoted out of JSON into a real column for indexable
 * loads, reversible, with its own migration (`20260601000002_message_compacted_column`).
 *
 *   `ttl_until integer`  the RESOLVED absolute turn (`applied_at + ttl`). NULL means the mechanism does
 *                        not apply at all, which is why "permanent" needs no value of its own — and why
 *                        a missing value on an old row already reads as permanent. Absolute rather than
 *                        "turns remaining", so the reader does a numeric range and never per-row
 *                        arithmetic.
 *   `ttl_scope text`     `tmp_xxx`: the span belongs to one temporary enable, so it can be revoked whole.
 *
 * Two more things ride along, because one migration should carry the whole tidying:
 *   - the message role index, so the turn counter stops scanning (`json_extract` over 15 368 message
 *     rows on this worktree's database);
 *   - `DROP TABLE IF EXISTS held_media`. A superseded pass in the same session put that table's DDL in
 *     the schema string, but no runtime carrying it was ever built, so THIS database never created it —
 *     verified by reading `sqlite_master`, not assumed. The drop is therefore defensive rather than a
 *     repair: it costs nothing, and it covers any database that did run that pass.
 *
 * ORDER, and why the guard is a real existence check: migrations run BEFORE the core schema DDL
 * (`db.ts:76`, then `:81`), so on a fresh database there are no tables at all and this must return
 * quietly — that DDL creates them with the columns already present. An `ALTER TABLE` against a missing
 * table would instead fail the whole migration at boot.
 */
const log = Log.create({ service: "migration" })

const migration: DatabaseMigration.Migration = {
  id: "20260919000000_part_ttl_columns",

  up(db) {
    const sqlite = db.$client
    /**
     * `null` AND `undefined` both mean "no row": bun's `get()` answers `null` for an empty result, so a
     * `!== undefined` test would call a missing table present and then fail the ALTER — which aborts the
     * whole migration run at boot on a fresh install. Caught by this migration's own test, which builds a
     * database with no `part` table and asserts the migration leaves it alone.
     */
    const tableExists = (name: string) => {
      const row = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
      return row !== null && row !== undefined
    }

    if (!tableExists("part")) {
      log.debug("part table absent — the core schema DDL creates it with the columns already present")
      return
    }

    const columns = new Set(
      (sqlite.prepare(`PRAGMA table_info('part')`).all() as { name: string }[]).map((column) => column.name),
    )
    for (const [column, type] of [
      ["ttl_until", "integer"],
      ["ttl_scope", "text"],
    ] as const) {
      if (columns.has(column)) continue
      sqlite.exec(`ALTER TABLE part ADD COLUMN ${column} ${type}`)
    }

    sqlite.exec(`CREATE INDEX IF NOT EXISTS part_ttl_until_idx ON part (session_id, ttl_until)`)

    if (tableExists("message")) {
      sqlite.exec(
        `CREATE INDEX IF NOT EXISTS message_session_role_idx ON message (session_id, json_extract(data, '$.role'))`,
      )
    }

    sqlite.exec(`DROP TABLE IF EXISTS held_media`)
  },
}

export default migration
