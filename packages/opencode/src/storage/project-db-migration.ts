import * as Log from "@opencode-ai/core/util/log"
import { Database, markProjectDbMode, getProjectDb } from "./db"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "project-db-migration" })

function rawExec(db: unknown) {
  return (db as { $client: { exec: (sql: string) => string | undefined } }).$client
}

export function needsMigration(db?: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never): boolean {
  if (db) {
    const hasSession = db.all<{ c: number }>("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='session'")
    if (hasSession[0]?.c === 0) return false
    const sessionCount = db.all<{ c: number }>("SELECT count(*) as c FROM session")
    return sessionCount[0]?.c > 0
  }
  return Database.use((d) => {
    const hasSession = d.all<{ c: number }>("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='session'")
    if (hasSession[0]?.c === 0) return false
    const sessionCount = d.all<{ c: number }>("SELECT count(*) as c FROM session")
    return sessionCount[0]?.c > 0
  })
}

export function migrateAll() {
  Database.use((globalDb) => {
    log.info("starting per-project database migration")
    const projects = globalDb.all<{ id: ProjectID; worktree: string }>("SELECT id, worktree FROM project")
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
  const projectDb = getProjectDb(projectID, worktree)
  log.info("migrating project", { projectID, worktree })

  Database.use((globalDb) => {
    // Copy session table first (filtered by project_id)
    log.info("copying session", { projectID })
    const sessionRows = globalDb.all<Record<string, unknown>>(
      `SELECT * FROM session WHERE project_id = '${escapeSql(projectID)}'`,
    )
    copyRows(projectDb, "session", sessionRows)

    for (const table of [
      "message",
      "part",
      "todo",
      "session_entry",
      "session_share",
    ]) {
      log.info("copying table", { table, projectID })
      const rows = globalDb.all<Record<string, unknown>>(
        `SELECT * FROM "${table}" WHERE session_id IN (SELECT id FROM session WHERE project_id = '${escapeSql(projectID)}')`,
      )
      copyRows(projectDb, table, rows)
    }

    // Event table uses aggregate_id instead of session_id
    log.info("copying event", { projectID })
    const eventRows = globalDb.all<Record<string, unknown>>(
      `SELECT * FROM event WHERE aggregate_id IN (SELECT id FROM session WHERE project_id = '${escapeSql(projectID)}')`,
    )
    copyRows(projectDb, "event", eventRows)

    for (const table of ["permission", "workspace"]) {
      log.info("copying table", { table, projectID })
      const rows = globalDb.all<Record<string, unknown>>(
        `SELECT * FROM "${table}" WHERE project_id = '${escapeSql(projectID)}'`,
      )
      if (rows.length > 0) copyRows(projectDb, table, rows)
    }

    // Build session_index in global DB
    log.info("building session_index", { projectID })
    rawExec(globalDb).exec(`
      INSERT OR IGNORE INTO session_index (id, project_id, directory, title, parent_id, workspace_id, time_created, time_updated, time_archived)
      SELECT id, project_id, directory, title, parent_id, workspace_id, time_created, time_updated, time_archived
      FROM session
      WHERE project_id = '${escapeSql(projectID)}'
    `)
  })

  // FTS backfill
  log.info("backfilling FTS", { projectID })
  try {
    rawExec(projectDb).exec(`
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
    `)
  } catch (e) {
    log.warn("failed to backfill FTS", { error: String(e) })
  }
}

function copyRows(db: ReturnType<typeof getProjectDb>, table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const columns = Object.keys(rows[0])
  const colList = columns.map((c) => `"${c}"`).join(", ")

  const exec = rawExec(db)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const values = columns.map((c) => {
      const val = row[c]
      if (val === null || val === undefined) return "NULL"
      if (typeof val === "number") return String(val)
      if (typeof val === "string") return `'${escapeSql(String(val))}'`
      return `'${escapeSql(JSON.stringify(val))}'`
    }).join(", ")
    try {
      exec.exec(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${values})`)
    } catch (e) {
      log.warn("failed to copy row", { table, row: i, error: String(e) })
      break
    }
  }
}

export function cleanupGlobal() {
  Database.use((db) => {
    log.info("cleaning up project-scoped tables from global database")
    for (const table of ["part_fts", "event", "session_share", "session_entry", "todo", "part", "message", "session", "permission", "workspace"]) {
      try {
        db.run(`DROP TABLE IF EXISTS "${table}"`)
        log.info("dropped table", { table })
      } catch (e) {
        log.warn("failed to drop table", { table, error: String(e) })
      }
    }
  })
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''")
}
