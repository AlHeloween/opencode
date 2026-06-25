import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "@/storage/db"
import { tmpdir } from "../fixture/fixture"
import { ProjectID } from "@/project/schema"
import { SessionID, MessageID, PartID } from "@/session/schema"

afterEach(() => {
  Database.close()
})

function now(): number {
  return Date.now()
}

/** Open a fresh project DB and return the Drizzle client. */
function openDB(worktree: string) {
  const projectID = ProjectID.make("proj_" + crypto.randomUUID())
  return {
    projectID,
    db: Database.getProjectDb(projectID, worktree),
  }
}

describe("FTS5 triggers", () => {
  test("part_fts virtual table and triggers exist after DB init", async () => {
    await using tmp = await tmpdir()
    const { db } = openDB(tmp.path)

    const ftsExists = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='part_fts'")
      .get() as { name: string } | undefined
    expect(ftsExists).not.toBeNull()
    expect(ftsExists!.name).toBe("part_fts")

    const triggers = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'part_fts_%'")
      .all() as Array<{ name: string }>
    expect(triggers).toHaveLength(3)

    const names = triggers.map((t) => t.name)
    expect(names).toContain("part_fts_insert")
    expect(names).toContain("part_fts_delete")
    expect(names).toContain("part_fts_update")
  })

  test("INSERT trigger populates part_fts with text content", async () => {
    await using tmp = await tmpdir()
    const { db, projectID } = openDB(tmp.path)
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())
    const messageID = MessageID.make("msg_" + crypto.randomUUID())
    const partID = PartID.make("part_" + crypto.randomUUID())
    const t = now()
    const textContent = "hello world — this is searchable test content"

    // Insert session (needed for FK, FK enforcement is ON)
    db.$client
      .prepare(
        `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionID, projectID, "test-slug", tmp.path, "Test Session", "0.0.0", t, t)

    // Insert message
    db.$client
      .prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(messageID, sessionID, t, t, JSON.stringify({}))

    // Insert part with text content — triggers part_fts_insert
    db.$client
      .prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        partID,
        messageID,
        sessionID,
        t,
        t,
        JSON.stringify({ type: "text", text: textContent }),
      )

    // Verify FTS row exists with extracted text
    const ftsRows = db.$client
      .prepare("SELECT part_id, text_content FROM part_fts WHERE part_id = ?")
      .all(partID) as Array<{ part_id: string; text_content: string }>
    expect(ftsRows).toHaveLength(1)
    expect(ftsRows[0].part_id).toBe(partID)
    expect(ftsRows[0].text_content).toBe(textContent)

    // Verify FTS5 full-text search finds the content
    const searchResults = db.$client
      .prepare("SELECT part_id FROM part_fts WHERE part_fts MATCH ?")
      .all("searchable") as Array<{ part_id: string }>
    expect(searchResults).toHaveLength(1)
    expect(searchResults[0].part_id).toBe(partID)
  })

  test("UPDATE trigger replaces old text in part_fts", async () => {
    await using tmp = await tmpdir()
    const { db, projectID } = openDB(tmp.path)
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())
    const messageID = MessageID.make("msg_" + crypto.randomUUID())
    const partID = PartID.make("part_" + crypto.randomUUID())
    const t = now()

    db.$client
      .prepare(
        `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionID, projectID, "test-slug", tmp.path, "Test", "0.0.0", t, t)

    db.$client
      .prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(messageID, sessionID, t, t, JSON.stringify({}))

    // Insert with initial text
    db.$client
      .prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(partID, messageID, sessionID, t, t, JSON.stringify({ type: "text", text: "original text" }))

    // Verify original text in FTS
    const before = db.$client
      .prepare("SELECT text_content FROM part_fts WHERE part_id = ?")
      .get(partID) as { text_content: string }
    expect(before.text_content).toBe("original text")

    // Update the part — triggers part_fts_update (DELETE old + INSERT new)
    const t2 = now()
    db.$client
      .prepare("UPDATE part SET data = ?, time_updated = ? WHERE id = ?")
      .run(JSON.stringify({ type: "text", text: "updated text content" }), t2, partID)

    // Verify FTS now has updated text (old removed, new present)
    const afterRows = db.$client
      .prepare("SELECT text_content FROM part_fts WHERE part_id = ?")
      .all(partID) as Array<{ text_content: string }>
    expect(afterRows).toHaveLength(1)
    expect(afterRows[0].text_content).toBe("updated text content")

    // Old text should NOT be findable
    const oldSearch = db.$client
      .prepare("SELECT part_id FROM part_fts WHERE part_fts MATCH ?")
      .all("original") as Array<{ part_id: string }>
    expect(oldSearch).toHaveLength(0)

    // New text SHOULD be findable
    const newSearch = db.$client
      .prepare("SELECT part_id FROM part_fts WHERE part_fts MATCH ?")
      .all("updated") as Array<{ part_id: string }>
    expect(newSearch).toHaveLength(1)
  })

  test("DELETE trigger removes row from part_fts", async () => {
    await using tmp = await tmpdir()
    const { db, projectID } = openDB(tmp.path)
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())
    const messageID = MessageID.make("msg_" + crypto.randomUUID())
    const partID = PartID.make("part_" + crypto.randomUUID())
    const t = now()

    db.$client
      .prepare(
        `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionID, projectID, "test-slug", tmp.path, "Test", "0.0.0", t, t)

    db.$client
      .prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(messageID, sessionID, t, t, JSON.stringify({}))

    // Insert part
    db.$client
      .prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(partID, messageID, sessionID, t, t, JSON.stringify({ type: "text", text: "deletable text" }))

    // Verify FTS row exists
    const before = db.$client
      .prepare("SELECT part_id FROM part_fts WHERE part_id = ?")
      .get(partID) as { part_id: string } | undefined
    expect(before).not.toBeNull()

    // Delete the part — triggers part_fts_delete
    db.$client.prepare("DELETE FROM part WHERE id = ?").run(partID)

    // Verify FTS row is gone
    const after = db.$client
      .prepare("SELECT part_id FROM part_fts WHERE part_id = ?")
      .get(partID) as { part_id: string } | undefined
    expect(after).toBeNull()
  })
})

describe("FTS5 durability", () => {
  test("FTS5 survives WAL checkpoint", async () => {
    await using tmp = await tmpdir()
    const { db } = openDB(tmp.path)

    // Force WAL checkpoint
    db.$client.exec("PRAGMA wal_checkpoint(TRUNCATE)")

    // Verify part_fts still exists
    const ftsExists = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='part_fts'")
      .get() as { name: string } | undefined
    expect(ftsExists).not.toBeNull()
    expect(ftsExists!.name).toBe("part_fts")

    // Triggers still registered
    const triggers = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'part_fts_%'")
      .all() as Array<{ name: string }>
    expect(triggers).toHaveLength(3)
  })

  test("FTS5 survives VACUUM", async () => {
    await using tmp = await tmpdir()
    const { db } = openDB(tmp.path)

    // VACUUM rebuilds the database file; virtual tables must survive
    db.$client.exec("VACUUM")

    // Verify part_fts still exists after vacuum
    const ftsExists = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='part_fts'")
      .get() as { name: string } | undefined
    expect(ftsExists).not.toBeNull()
    expect(ftsExists!.name).toBe("part_fts")

    // Verify triggers are still present
    const triggers = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'part_fts_%'")
      .all() as Array<{ name: string }>
    expect(triggers).toHaveLength(3)
  })
})
