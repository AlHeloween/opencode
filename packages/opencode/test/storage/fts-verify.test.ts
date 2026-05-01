import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database as BunDB } from "bun:sqlite"
import path from "path"
import { readFileSync } from "fs"

const migrationDir = path.join(import.meta.dirname, "../../migration/20260414120000_semantic_vector")
const migrationSql = readFileSync(path.join(migrationDir, "migration.sql"), "utf-8")

function createPartTable(db: BunDB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS part(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    )
  `)
}

function createSessionTable(db: BunDB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session(
      id TEXT PRIMARY KEY,
      project_id TEXT,
      slug TEXT,
      directory TEXT,
      title TEXT,
      version TEXT,
      time_created INTEGER,
      time_updated INTEGER
    )
  `)
}

function setupTestDB(db: BunDB) {
  createPartTable(db)
  createSessionTable(db)
}

describe("FTS migration SQL", () => {
  test("contains part_fts virtual table creation", () => {
    expect(migrationSql).toContain("CREATE VIRTUAL TABLE part_fts USING fts5")
  })

  test("contains semantic column definitions", () => {
    expect(migrationSql).toContain("semantic_vector")
    expect(migrationSql).toContain("dominant_topic")
    expect(migrationSql).toContain("exact_coef")
    expect(migrationSql).toContain("inferred_coef")
    expect(migrationSql).toContain("hypothetical_coef")
    expect(migrationSql).toContain("guess_coef")
    expect(migrationSql).toContain("unknown_coef")
  })

  test("contains tokenize=porter", () => {
    expect(migrationSql).toContain("tokenize='porter'")
  })

  test("contains insert trigger", () => {
    expect(migrationSql).toContain("CREATE TRIGGER part_fts_insert")
  })

  test("contains delete trigger", () => {
    expect(migrationSql).toContain("CREATE TRIGGER part_fts_delete")
  })

  test("contains update trigger", () => {
    expect(migrationSql).toContain("CREATE TRIGGER part_fts_update")
  })

  test("contains backfill SQL", () => {
    expect(migrationSql).toContain("INSERT INTO part_fts(part_id, session_id, message_id")
  })
})

describe("FTS5 schema application", () => {
  let db: BunDB

  beforeEach(() => {
    db = new BunDB(":memory:")
    setupTestDB(db)
    db.exec(migrationSql)
  })

  afterEach(() => {
    db.close()
  })

  test("creates part_fts table with all columns", () => {
    const schema = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='part_fts'").get() as
      | { sql: string }
      | undefined
    expect(schema).toBeDefined()
    expect(schema!.sql).toContain("semantic_vector")
    expect(schema!.sql).toContain("dominant_topic")
    expect(schema!.sql).toContain("exact_coef")
    expect(schema!.sql).toContain("text_content")
  })

  test("triggers exist after migration", () => {
    const triggers = db
      .query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'part_fts_%'")
      .all() as { name: string }[]
    expect(triggers.length).toBeGreaterThanOrEqual(3)

    const names = triggers.map((t) => t.name).sort()
    expect(names).toContain("part_fts_insert")
    expect(names).toContain("part_fts_delete")
    expect(names).toContain("part_fts_update")
  })

  test("inserts text into FTS on part insert via trigger", () => {
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p1', 's1', 'm1', 1, '{\"type\":\"text\",\"text\":\"hello world test message\",\"exact_coef\":5,\"inferred_coef\":3,\"hypothetical_coef\":1,\"guess_coef\":1,\"unknown_coef\":0,\"semantic_vector\":\"database(1.00) typescript(0.50)\",\"dominant_topic\":\"database\"}')",
    )

    const ftsRows = db.query("SELECT * FROM part_fts WHERE part_id = 'p1'").all() as any[]
    expect(ftsRows.length).toBe(1)
    expect(ftsRows[0].text_content).toContain("hello world test message")
    expect(ftsRows[0].exact_coef).toBe(5)
    expect(ftsRows[0].inferred_coef).toBe(3)
    expect(ftsRows[0].semantic_vector).toBe("database(1.00) typescript(0.50)")
    expect(ftsRows[0].dominant_topic).toBe("database")
  })

  test("deletes from FTS via delete trigger", () => {
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p1', 's1', 'm1', 1, '{\"type\":\"text\",\"text\":\"test\"}')",
    )

    let ftsRows = db.query("SELECT count(*) as c FROM part_fts").get() as { c: number }
    expect(ftsRows.c).toBe(1)

    db.run("DELETE FROM part WHERE id = 'p1'")

    ftsRows = db.query("SELECT count(*) as c FROM part_fts").get() as { c: number }
    expect(ftsRows.c).toBe(0)
  })

  test("FTS5 MATCH returns matching results", () => {
    db.run(
      "INSERT INTO session(id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s1', 'proj1', 'slug1', '/tmp', 'Test Session', '1.0', 1, 1)",
    )
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p1', 's1', 'm1', 1, '{\"type\":\"text\",\"text\":\"hello world\"}')",
    )
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p2', 's1', 'm2', 1, '{\"type\":\"text\",\"text\":\"foo bar baz\"}')",
    )

    const results = db.query("SELECT * FROM part_fts WHERE part_fts MATCH 'hello'").all()
    expect(results.length).toBe(1)
  })

  test("semantic rank query works with BM25", () => {
    db.run(
      "INSERT INTO session(id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s1', 'proj1', 'slug1', '/tmp', 'Test Session', '1.0', 1, 1)",
    )
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p1', 's1', 'm1', 1, '{\"type\":\"text\",\"text\":\"hello world\",\"exact_coef\":8,\"inferred_coef\":2,\"hypothetical_coef\":0,\"guess_coef\":0,\"unknown_coef\":0}')",
    )
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p2', 's1', 'm2', 1, '{\"type\":\"text\",\"text\":\"hello maybe something\",\"exact_coef\":3,\"inferred_coef\":2,\"hypothetical_coef\":3,\"guess_coef\":2,\"unknown_coef\":0}')",
    )

    const results = db
      .query(
        `
      SELECT
        fts.text_content as text,
        (fts.exact_coef * 10 + fts.inferred_coef * 7 + fts.hypothetical_coef * 4 + fts.guess_coef * 2 + fts.unknown_coef * 1) as semantic_rank,
        bm25(part_fts) as rank
      FROM part_fts fts
      WHERE part_fts MATCH 'hello'
      ORDER BY semantic_rank DESC, bm25(part_fts)
    `,
      )
      .all() as any[]

    expect(results.length).toBe(2)
    expect(results[0].semantic_rank).toBeGreaterThan(results[1].semantic_rank)
  })
})

describe("FTS5 backfill", () => {
  let db: BunDB

  beforeEach(() => {
    db = new BunDB(":memory:")
    setupTestDB(db)
  })

  afterEach(() => {
    db.close()
  })

  test("backfills existing parts into FTS", () => {
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p1', 's1', 'm1', 1, '{\"type\":\"text\",\"text\":\"alpha message\"}')",
    )
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p2', 's1', 'm2', 1, '{\"type\":\"text\",\"text\":\"beta message\"}')",
    )
    db.run(
      "INSERT INTO part(id, session_id, message_id, time_created, data) VALUES ('p3', 's1', 'm3', 1, '{\"type\":\"tool\",\"state\":{\"output\":\"tool output content\"}}')",
    )

    db.exec(migrationSql)

    const ftsRows = db.query("SELECT count(*) as c FROM part_fts").get() as { c: number }
    expect(ftsRows.c).toBe(3)

    const textParts = db.query("SELECT text_content FROM part_fts WHERE part_type = 'text'").all() as any[]
    expect(textParts.length).toBe(2)

    const toolParts = db.query("SELECT text_content FROM part_fts WHERE part_type = 'tool'").all() as any[]
    expect(toolParts.length).toBe(1)
    expect(toolParts[0].text_content).toContain("tool output content")
  })
})
