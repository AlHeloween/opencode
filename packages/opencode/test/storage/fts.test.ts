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

function openDB(worktree: string) {
  const projectID = ProjectID.make("proj_" + crypto.randomUUID())
  return {
    projectID,
    db: Database.getProjectDb(projectID, worktree),
  }
}

describe("message search (LIKE)", () => {
  test("LIKE search finds inserted part text", async () => {
    await using tmp = await tmpdir()
    const { db, projectID } = openDB(tmp.path)
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())
    const messageID = MessageID.make("msg_" + crypto.randomUUID())
    const partID = PartID.make("part_" + crypto.randomUUID())
    const t = now()
    const textContent = "hello world — this is searchable test content"

    db.$client
      .prepare(
        `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionID, projectID, "test-slug", tmp.path, "Test Session", "0.0.0", t, t)

    db.$client
      .prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(messageID, sessionID, t, t, JSON.stringify({}))

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

    // LIKE search should find the content
    const results = db.$client
      .prepare(
        `SELECT p.id as partID, p.data FROM part p
         JOIN message m ON m.id = p.message_id
         JOIN session s ON s.id = p.session_id
         WHERE s.project_id = ? AND p.data LIKE ?`,
      )
      .all(projectID, "%searchable%") as Array<{ partID: string }>
    expect(results).toHaveLength(1)
    expect(results[0].partID).toBe(partID)
  })

  test("LIKE search is case-insensitive for ASCII", async () => {
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
        JSON.stringify({ type: "text", text: "TypeScript Interfaces" }),
      )

    // SQLite LIKE is case-insensitive for ASCII by default
    const results = db.$client
      .prepare(
        `SELECT p.id FROM part p
         JOIN message m ON m.id = p.message_id
         JOIN session s ON s.id = p.session_id
         WHERE s.project_id = ? AND p.data LIKE ?`,
      )
      .all(projectID, "%typescript%") as Array<{ id: string }>
    expect(results).toHaveLength(1)
  })

  test("LIKE %pattern% finds partial matches", async () => {
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
        JSON.stringify({ type: "text", text: "reimplementation of cache checkpoint" }),
      )

    // Partial word match should work (unlike FTS5 exact match)
    const results = db.$client
      .prepare(
        `SELECT p.id FROM part p
         JOIN message m ON m.id = p.message_id
         JOIN session s ON s.id = p.session_id
         WHERE s.project_id = ? AND p.data LIKE ?`,
      )
      .all(projectID, "%implement%") as Array<{ id: string }>
    expect(results).toHaveLength(1)
  })

  test("LIKE search returns empty for no match", async () => {
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

    db.$client
      .prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(partID, messageID, sessionID, t, t, JSON.stringify({ type: "text", text: "some content" }))

    const results = db.$client
      .prepare(
        `SELECT p.id FROM part p
         JOIN message m ON m.id = p.message_id
         JOIN session s ON s.id = p.session_id
         WHERE s.project_id = ? AND p.data LIKE ?`,
      )
      .all(projectID, "%nonexistent%") as Array<{ id: string }>
    expect(results).toHaveLength(0)
  })

  test("epistemic coefficients stored in part.data are queryable", async () => {
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
        JSON.stringify({
          type: "text",
          text: "The function returns a const value",
          exact_coef: 8,
          inferred_coef: 2,
          hypothetical_coef: 0,
          guess_coef: 0,
          unknown_coef: 0,
        }),
      )

    // Verify coefficients can be read via json_extract
    const row = db.$client
      .prepare(`SELECT json_extract(data, '$.exact_coef') as exact_coef FROM part WHERE id = ?`)
      .get(partID) as { exact_coef: number }
    expect(row.exact_coef).toBe(8)

    // Verify semantic rank is computed correctly
    const rankRow = db.$client
      .prepare(`
        SELECT
          (COALESCE(json_extract(data, '$.exact_coef'), 0) * 10 +
           COALESCE(json_extract(data, '$.inferred_coef'), 0) * 7 +
           COALESCE(json_extract(data, '$.hypothetical_coef'), 0) * 4 +
           COALESCE(json_extract(data, '$.guess_coef'), 0) * 2 +
           COALESCE(json_extract(data, '$.unknown_coef'), 0) * 1) as rank
        FROM part WHERE id = ?`)
      .get(partID) as { rank: number }
    expect(rankRow.rank).toBe(8 * 10 + 2 * 7) // 80 + 14 = 94
  })
})
