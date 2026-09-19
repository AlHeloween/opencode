import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { DatabaseMigration } from "@/storage/migration"
import migration from "../../migration/20260919000000_part_ttl_columns"

/**
 * The TTL migration, driven through its OWN `DbClient` shape against an OLD database.
 *
 * A migration is the one kind of code whose oracle cannot be the suite that runs after it: by then the
 * schema is already right. So this builds the previous shape by hand — `part` without the two columns, a
 * `message` table, and the orphan `held_media` a superseded pass would have left behind — runs `up()`,
 * and reads the result back the way every write-path change here is verified: `PRAGMA`/`sqlite_master`.
 *
 * The three properties that matter, each one a real failure mode:
 *   1. a second run must be a no-op, because the runner retries a migration it has not recorded, and a
 *      bad column guard would take the database down at BOOT;
 *   2. a database with no `part` yet must be left alone, because migrations run BEFORE the core schema
 *      DDL (db.ts:76, then :81) — the DDL creates the table with the columns already present;
 *   3. existing rows must survive untouched.
 */

/**
 * Drive the migration the way its runner does, providing exactly the surface it touches.
 *
 * The cast is deliberate and confined to this one adapter. `DatabaseMigration.DbClient` extends bun's
 * whole `SQLiteBunDatabase` — eighteen more members — so no genuine test double can satisfy it
 * structurally, and the alternative (spreading `as never` across four call sites) would hide the reason
 * instead of stating it. What the migration calls is `$client.exec` and `$client.prepare`; if it ever
 * reaches for more, this double throws at runtime and the test fails loudly rather than passing quietly.
 */
const client = (db: Database) =>
  ({
    $client: {
      close: () => db.close(),
      exec: (sql: string) => db.run(sql),
      prepare: (sql: string) => db.query(sql),
    },
  }) as unknown as DatabaseMigration.DbClient

/** The schema as it stood BEFORE this migration: no ttl columns, plus the superseded table. */
const oldSchema = (db: Database) => {
  db.run(`CREATE TABLE "part" (id text PRIMARY KEY NOT NULL, message_id text NOT NULL, session_id text NOT NULL,
          type text NOT NULL DEFAULT 'unknown', tool_name text, status text,
          time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`)
  db.run(`CREATE TABLE "message" (id text PRIMARY KEY NOT NULL, session_id text NOT NULL,
          time_created integer NOT NULL, time_updated integer NOT NULL, compacted integer NOT NULL DEFAULT 0,
          data text NOT NULL)`)
  db.run(`CREATE TABLE "held_media" (message_id text PRIMARY KEY NOT NULL, session_id text NOT NULL,
          expires_at_turn integer NOT NULL, reason text, time_created integer NOT NULL, time_updated integer NOT NULL)`)
}

const names = (db: Database, sql: string) =>
  db
    .query(sql)
    .all()
    .map((row) => (row as { name: string }).name)

describe("the part ttl migration", () => {
  test("adds both columns and both indexes, and a second run is a no-op", () => {
    const db = new Database(":memory:")
    oldSchema(db)

    migration.up(client(db))
    const columns = names(db, `PRAGMA table_info('part')`)
    expect(columns).toContain("ttl_until")
    expect(columns).toContain("ttl_scope")
    const indexes = names(db, `SELECT name FROM sqlite_master WHERE type = 'index'`)
    expect(indexes).toContain("part_ttl_until_idx")
    expect(indexes).toContain("message_session_role_idx")

    // A migration whose column guard is wrong throws HERE — at boot, on every start, forever.
    expect(() => migration.up(client(db))).not.toThrow()
    expect(names(db, `PRAGMA table_info('part')`)).toContain("ttl_until")
    db.close()
  })

  test("a database with no part table is left alone — the DDL owns that case", () => {
    const db = new Database(":memory:")
    expect(() => migration.up(client(db))).not.toThrow()
    expect(db.query(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get()).toEqual({ n: 0 })
    db.close()
  })

  test("drops the orphan table and leaves existing rows untouched", () => {
    const db = new Database(":memory:")
    oldSchema(db)
    db.run(`INSERT INTO "part" (id, message_id, session_id, type, time_created, time_updated, data)
            VALUES ('prt_1', 'msg_1', 'ses_1', 'text', 1, 1, '{"text":"kept"}')`)
    expect(names(db, `SELECT name FROM sqlite_master WHERE type = 'table'`)).toContain("held_media")

    migration.up(client(db))

    expect(names(db, `SELECT name FROM sqlite_master WHERE type = 'table'`)).not.toContain("held_media")
    expect(db.query(`SELECT id, data FROM part`).all()).toEqual([{ id: "prt_1", data: '{"text":"kept"}' }])
    // The old row's ttl columns read as NULL, which IS the wanted semantics: the mechanism does not apply.
    expect(db.query(`SELECT ttl_until, ttl_scope FROM part`).get()).toEqual({ ttl_until: null, ttl_scope: null })
    db.close()
  })
})
