import { Database as BunDatabase } from "bun:sqlite"
import { existsSync } from "fs"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@/storage/db"
import { normalizeWorktreePath, remapWorktreePath } from "./project"

const log = Log.create({ service: "project.database-fix" })

type ProjectRow = { id: string; worktree: string }
type SessionRow = { id: string; directory: string }

function isInside(root: string, value: string) {
  const relative = path.relative(root, value)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

export namespace ProjectDatabaseFix {
  export type Input = {
    directory: string
  }

  export type Result = {
    database: string
    from: string
    to: string
    projects: number
    sessions: number
  }

  function resolveSource(to: string, projects: ProjectRow[], sessions: SessionRow[]) {
    const projectRoots = [...new Set(projects.map((project) => normalizeWorktreePath(project.worktree)))].filter((root) => root !== to)
    if (projectRoots.length === 1) return projectRoots[0]
    if (projectRoots.length > 1) throw new Error("Database has multiple saved project roots; repair requires manual review")

    const sessionRoots = [...new Set(sessions.map((session) => normalizeWorktreePath(session.directory)))].filter(
      (directory) => !isInside(to, directory),
    )
    if (sessionRoots.length === 1) return sessionRoots[0]
    if (sessionRoots.length === 0) throw new Error("Database has no stored path outside the current worktree")
    throw new Error("Database has multiple saved session paths; repair requires manual review")
  }

  export function run(input: Input): Result {
    const to = normalizeWorktreePath(path.resolve(input.directory))
    const database = Database.getProjectDbPath(to)
    if (!existsSync(database)) throw new Error(`Database not found at ${database}`)

    const db = new BunDatabase(database)
    try {
      const projects = db.query<ProjectRow, []>("SELECT id, worktree FROM project").all()
      if (projects.length === 0) throw new Error(`No projects found in ${database}`)
      const sessions = db.query<SessionRow, []>("SELECT id, directory FROM session").all()
      const from = resolveSource(to, projects, sessions)
      const projectUpdates = projects
        .map((project) => ({ id: project.id, worktree: remapWorktreePath(project.worktree, from, to) }))
        .filter((project, index) => project.worktree !== projects[index].worktree)
      const sessionUpdates = sessions
        .map((session) => ({ id: session.id, directory: remapWorktreePath(session.directory, from, to) }))
        .filter((session, index) => session.directory !== sessions[index].directory)

      db.run("BEGIN IMMEDIATE")
      try {
        const updateProject = db.query("UPDATE project SET worktree = ? WHERE id = ?")
        const updateSession = db.query("UPDATE session SET directory = ? WHERE id = ?")
        for (const project of projectUpdates) updateProject.run(project.worktree, project.id)
        for (const session of sessionUpdates) updateSession.run(session.directory, session.id)
        db.run("COMMIT")
      } catch (error) {
        db.run("ROLLBACK")
        log.warn("database fix rolled back", { database, error: String(error) })
        throw error
      }

      return { database, from, to, projects: projectUpdates.length, sessions: sessionUpdates.length }
    } finally {
      db.close()
    }
  }
}
