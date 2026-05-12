import * as Log from "@opencode-ai/core/util/log"
import { Database, markProjectDbMode, getProjectDb } from "./db"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "project-db-migration" })

function rawExec(db: unknown) {
  return (db as { $client: { exec: (sql: string) => void } }).$client.exec
}

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

  const exec = rawExec(projectDb)

  Database.use((globalDb) => {
    const globalExec = rawExec(globalDb)
    const globalPath = Database.Path

    // Use ATTACH for efficient bulk copy
    exec(`ATTACH '${escapeSql(globalPath)}' AS global_source`)

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

    for (const table of tables) {
      log.info("copying table", { table, projectID })
      let sql: string
      if (table === "permission" || table === "workspace") {
        sql = `INSERT OR REPLACE INTO "${table}" SELECT * FROM global_source."${table}" WHERE project_id = '${escapeSql(projectID)}'`
      } else if (table === "event") {
        sql = `INSERT OR REPLACE INTO "${table}" SELECT * FROM global_source."${table}" WHERE aggregate_id IN (SELECT id FROM global_source.session WHERE project_id = '${escapeSql(projectID)}')`
      } else {
        sql = `INSERT OR REPLACE INTO "${table}" SELECT * FROM global_source."${table}" WHERE session_id IN (SELECT id FROM global_source.session WHERE project_id = '${escapeSql(projectID)}')`
      }
      try {
        exec(sql)
      } catch (e) {
        log.warn("failed to copy table", { table, error: String(e) })
      }
    }

    exec("DETACH global_source")

    // FTS backfill
    log.info("backfilling FTS", { projectID })
    try {
      exec(`
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

    // Build session_index in global DB
    log.info("building session_index", { projectID })
    globalExec(`
      INSERT OR IGNORE INTO session_index (id, project_id, directory, title, parent_id, workspace_id, time_created, time_updated, time_archived)
      SELECT id, project_id, directory, title, parent_id, workspace_id, time_created, time_updated, time_archived
      FROM session
      WHERE project_id = '${escapeSql(projectID)}'
    `)
  })
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''")
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
