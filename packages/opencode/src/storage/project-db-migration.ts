import * as Log from "@opencode-ai/core/util/log"
import { Database, markProjectDbMode } from "./db"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "project-db-migration" })

export function needsMigration(): boolean {
  return Database.use((db) => {
    const hasSession = db
      .all<{ c: number }>("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='session'")
    if (hasSession[0]?.c === 0) return false

    const sessionCount = db.all<{ c: number }>("SELECT count(*) as c FROM session")
    return sessionCount[0]?.c > 0
  })
}

export function migrateAll() {
  Database.use((globalDb) => {
    log.info("starting per-project database migration")

    const projects = globalDb.all<{ id: ProjectID; worktree: string }>(
      "SELECT id, worktree FROM project",
    )
    log.info("migrating projects", { count: projects.length })

    for (const project of projects) {
      migrateProject(project.id, project.worktree)
    }

    log.info("per-project database migration complete")

    cleanupGlobal()
    markProjectDbMode()
    log.info("switched to project database mode")
  })
}

function migrateProject(projectID: ProjectID, worktree: string) {
  const projectDb = Database.getProjectDb(projectID, worktree)
  log.info("migrating project", { projectID, worktree })

  const tables = [
    "session",
    "message",
    "part",
    "todo",
    "session_entry",
    "permission",
    "session_share",
    "workspace",
    "event",
  ]

  Database.use((globalDb) => {
    for (const table of tables) {
      const col = table === "permission" || table === "workspace" ? "project_id" : "session_id"

      log.info("copying table", { table, projectID })
      const rows = globalDb.all<Record<string, unknown>>(
        `SELECT * FROM "${table}" WHERE "${col}" IN (SELECT id FROM session WHERE project_id = ?)`,
        [projectID],
      )

      if (rows.length === 0) {
        // For permission and workspace, try project_id directly
        if (table === "permission" || table === "workspace") {
          const directRows = globalDb.all<Record<string, unknown>>(
            `SELECT * FROM "${table}" WHERE project_id = ?`,
            [projectID],
          )
          if (directRows.length === 0) continue
          insertRows(projectDb, table, directRows)
          continue
        }
        continue
      }

      insertRows(projectDb, table, rows)
    }
  })

  // Populate FTS index for copied parts
  log.info("backfilling FTS index", { projectID })
  projectDb.run(`
    INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
    SELECT
      p.id, p.session_id, p.message_id,
      json_extract(p.data, '$.type'),
      COALESCE(json_extract(p.data, '$.text'), json_extract(p.data, '$.state.output'), json_extract(p.data, '$.state.error'), json_extract(p.data, '$.filename'), ''),
      COALESCE(json_extract(p.data, '$.semantic_vector'), ''),
      COALESCE(json_extract(p.data, '$.dominant_topic'), ''),
      COALESCE(json_extract(p.data, '$.exact_coef'), 0),
      COALESCE(json_extract(p.data, '$.inferred_coef'), 0),
      COALESCE(json_extract(p.data, '$.hypothetical_coef'), 0),
      COALESCE(json_extract(p.data, '$.guess_coef'), 0),
      COALESCE(json_extract(p.data, '$.unknown_coef'), 0)
    FROM part p
    WHERE p.session_id IN (SELECT id FROM session WHERE project_id = ?)
  `, [projectID])

  // Build session_index in global DB
  log.info("building session_index", { projectID })
  Database.use((globalDb) => {
    globalDb.run(`
      INSERT OR IGNORE INTO session_index (id, project_id, directory, title, parent_id, workspace_id, time_created, time_updated, time_archived)
      SELECT id, project_id, directory, title, parent_id, workspace_id, time_created, time_updated, time_archived
      FROM session
      WHERE project_id = ?
    `, [projectID])
  })
}

function insertRows(db: ReturnType<typeof Database.getProjectDb>, table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return

  const columns = Object.keys(rows[0])
  const placeholders = columns.map(() => "?").join(", ")
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
  )

  for (const row of rows) {
    stmt.run(...columns.map((c) => row[c]))
  }
}

export function cleanupGlobal() {
  Database.use((db) => {
    log.info("cleaning up project-scoped tables from global database")
    const tables = [
      "part_fts",
      "event",
      "session_share",
      "session_entry",
      "todo",
      "part",
      "message",
      "session",
      "permission",
      "workspace",
    ]
    for (const table of tables) {
      try {
        db.run(`DROP TABLE IF EXISTS "${table}"`)
        log.info("dropped table", { table })
      } catch (e) {
        log.warn("failed to drop table", { table, error: String(e) })
      }
    }
  })
}

export * as ProjectDbMigration from "."
