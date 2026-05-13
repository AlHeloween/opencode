import { afterAll, describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Database } from "../../src/storage/db"
import { needsMigration, migrateAll, cleanupGlobal } from "../../src/storage/project-db-migration"
import { SessionID } from "../../src/session/schema"

afterAll(async () => {
  Database.close()
})

function exec(sql: string) {
  Database.use((db) => {
    const raw = (db as unknown as { $client: { exec: (sql: string) => void } }).$client
    raw.exec("PRAGMA foreign_keys = OFF")
    raw.exec(sql)
    raw.exec("PRAGMA foreign_keys = ON")
  })
}

function query<T = Record<string, unknown>>(sql: string): T[] {
  return Database.use((db) => db.all<T>(sql))
}

describe("project-db-migration", () => {
  test("needsMigration returns false when no session table", () => {
    expect(needsMigration()).toBe(false)
  })

  test("needsMigration returns true after inserting a session row", async () => {
    await using tmp = await tmpdir()
    exec("CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT 'proj1', directory TEXT NOT NULL DEFAULT '/', title TEXT NOT NULL DEFAULT 'test', slug TEXT NOT NULL DEFAULT 'test', version TEXT NOT NULL DEFAULT '1.0', time_created INTEGER NOT NULL DEFAULT 1, time_updated INTEGER NOT NULL DEFAULT 1)")
    exec("INSERT INTO session (id, project_id, directory, title, slug, version, time_created, time_updated) VALUES ('ses1', 'proj1', '/', 'Test', 'test', '1.0', 1, 1)")
    expect(needsMigration()).toBe(true)
    exec("DROP TABLE IF EXISTS session")
  })

  test("migrateAll copies data to project DB and populates session_index", async () => {
    await using tmp = await tmpdir()

    const projectID = "test_project"
    const worktree = tmp.path
    const sessionID = SessionID.make("ses_migrate_test")

    // Set up global DB tables via raw $client to bypass Drizzle schema validation
    exec("CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, time_created INTEGER NOT NULL DEFAULT 1, time_updated INTEGER NOT NULL DEFAULT 1, sandboxes TEXT NOT NULL DEFAULT '[]')")
    exec(`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('${projectID}', '${worktree}', 1, 1, '[]')`)

    exec("CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, version TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, parent_id TEXT, workspace_id TEXT, time_archived INTEGER)")
    exec(`INSERT INTO session (id, project_id, directory, title, slug, version, time_created, time_updated) VALUES ('${sessionID}', '${projectID}', '${worktree}', 'Test Session', 'test', '1.0', 1, 1)`)

    exec("CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)")
    exec(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg1', '${sessionID}', 1, 1, '{}')`)

    exec("CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)")
    exec(`INSERT INTO part (id, session_id, message_id, time_created, time_updated, data) VALUES ('part1', '${sessionID}', 'msg1', 1, 1, '{}')`)

    exec("CREATE TABLE IF NOT EXISTS todo (session_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, position INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, PRIMARY KEY (session_id, position))")
    exec("CREATE TABLE IF NOT EXISTS session_entry (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)")
    exec("CREATE TABLE IF NOT EXISTS permission (project_id TEXT PRIMARY KEY, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)")
    exec("CREATE TABLE IF NOT EXISTS session_share (session_id TEXT PRIMARY KEY, id TEXT NOT NULL, secret TEXT NOT NULL, url TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)")
    exec("CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, type TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '')")
    exec("CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)")

    // Run migration
    migrateAll()

    // Verify project DB exists and has data
    const projectDbPath = Database.getProjectDbPath(worktree)
    const exists = await fs.stat(projectDbPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)

    const projectDb = Database.getProjectDb(projectID as any, worktree)
    const sessions = projectDb.all<{ id: string }>("SELECT id FROM session")
    expect(sessions.length).toBe(1)
    expect(sessions[0].id).toBe(sessionID)

    const messages = projectDb.all<{ id: string }>("SELECT id FROM message")
    expect(messages.length).toBe(1)
    expect(messages[0].id).toBe("msg1")

    const parts = projectDb.all<{ id: string }>("SELECT id FROM part")
    expect(parts.length).toBe(1)
    expect(parts[0].id).toBe("part1")

    // Verify session_index populated
    Database.use((db) => {
      const indexRows = db.all<{ id: string }>(`SELECT id FROM session_index WHERE project_id = '${projectID}'`)
      expect(indexRows.length).toBe(1)
      expect(indexRows[0].id).toBe(sessionID)
    })

    // Clean up project DB
    Database.closeProjectDb(projectID as any)
  })

  test("cleanupGlobal drops project-scoped tables", async () => {
    await using tmp = await tmpdir()

    exec("CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, version TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)")
    exec("CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)")

    cleanupGlobal()

    const sessionTable = query<{ c: number }>("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='session'")
    expect(sessionTable[0].c).toBe(0)

    const messageTable = query<{ c: number }>("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='message'")
    expect(messageTable[0].c).toBe(0)
  })
})
