import { Effect, Context, Layer, Schema } from "effect"
import { SessionID } from "../session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "bun:sqlite"
import path from "path"
import { existsSync, mkdirSync } from "fs"

const log = Log.create({ service: "jobs" })

/** Unique job identifier: "bash-3" or "task-1" */
export const JobID = Schema.String.pipe(Schema.brand("JobID"))
export type JobID = Schema.Schema.Type<typeof JobID>

export const JobStatus = Schema.Literals(["running", "done", "failed", "killed"])
export type JobStatus = Schema.Schema.Type<typeof JobStatus>

export const JobKind = Schema.Literals(["bash", "task"])
export type JobKind = Schema.Schema.Type<typeof JobKind>

export interface JobInfo {
  readonly id: JobID
  readonly kind: JobKind
  readonly label: string
  readonly status: JobStatus
  readonly startedAt: number
}

interface Job {
  readonly id: JobID
  readonly kind: JobKind
  readonly label: string
  readonly sessionID: SessionID
  status: JobStatus
  output: string
  result: string
  resultSurfaced: boolean
  startedAt: number
  finishedAt: number
  cancel: () => void
}

interface Completion {
  sessionID: SessionID
  text: string
}

export interface Interface {
  readonly start: (input: {
    sessionID: SessionID
    kind: JobKind
    label: string
    run: (signal: AbortSignal, writeOutput: (chunk: string) => void) => Promise<string>
  }) => Effect.Effect<JobID>

  readonly startEffect: (input: {
    sessionID: SessionID
    kind: JobKind
    label: string
    run: Effect.Effect<string, Error>
  }) => Effect.Effect<JobID>

  readonly output: (input: { sessionID: SessionID; jobID: JobID }) => Effect.Effect<{ text: string; status: JobStatus }>

  readonly kill: (input: { sessionID: SessionID; jobID: JobID }) => Effect.Effect<boolean>

  readonly list: (input: { sessionID: SessionID }) => Effect.Effect<JobInfo[]>

  readonly drainCompletedNote: (input: { sessionID: SessionID }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Jobs") {}

/** Get the jobs.db path — same folder as the main opencode.db */
function getJobsDbPath(): string {
  // Use the worktree-relative data path, same as main DB
  const { Global } = require("@opencode-ai/core/global") as typeof import("@opencode-ai/core/global")
  const dir = path.join(Global.Path.data)
  return path.join(dir, "jobs.db")
}

/** Open (or create) the jobs database */
let _jobsDb: Database | undefined
let _jobsDbPath: string | undefined

function getJobsDb(): Database {
  const dbPath = getJobsDbPath()
  if (_jobsDb && _jobsDbPath === dbPath) return _jobsDb

  // Close previous if path changed
  if (_jobsDb) {
    try { _jobsDb.close() } catch { /* ignore */ }
  }

  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath, { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA foreign_keys = ON")

  // Create jobs table
  db.run(`
    CREATE TABLE IF NOT EXISTS job (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      output TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS job_session_idx ON job (session_id)")

  // Recover: mark any running jobs from a prior crash as killed
  const orphanResult = db.run(
    "UPDATE job SET status = 'killed', finished_at = ? WHERE status = 'running'",
    [Date.now()],
  )
  if (orphanResult.changes > 0) {
    log.info("orphan jobs recovered", { count: orphanResult.changes })
  }

  _jobsDb = db
  _jobsDbPath = dbPath
  return db
}

function dbInsert(sqldb: Database, j: Job) {
  sqldb.run(
    `INSERT OR REPLACE INTO job (id, session_id, kind, label, status, output, result, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [j.id, j.sessionID, j.kind, j.label, j.status, j.output, j.result, j.startedAt, j.finishedAt],
  )
}

function dbUpdate(sqldb: Database, j: Job) {
  sqldb.run(
    `UPDATE job SET status = ?, output = ?, result = ?, finished_at = ? WHERE id = ?`,
    [j.status, j.output, j.result, j.finishedAt, j.id],
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Concurrency gate: max 2 simultaneous background jobs
    // Prevents resource exhaustion from unlimited parallel sub-agents.
    // Plain JS semaphore — avoids Effect service dependency.
    const maxJobs = 2
    let running = 0
    const waiters: Array<() => void> = []
    const acquire = (): Promise<void> => {
      if (running < maxJobs) {
        running++
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        waiters.push(() => { running++; resolve() })
      })
    }
    const release = (): void => {
      running--
      const next = waiters.shift()
      if (next) next()
    }

    // In-memory job store for live fiber access + SQLite for durability
    const jobs = new Map<string, Job>()
    const completed: Completion[] = []
    const readOffsets = new Map<string, number>()
    const counters = new Map<string, number>()

    // Initialize jobs DB
    const db = getJobsDb()

    function key(sessionID: SessionID, jobID: JobID) {
      return `${sessionID}\x00${jobID}`
    }

    function nextID(sessionID: SessionID, kind: JobKind): JobID {
      const k = `${sessionID}\x00${kind}`
      const n = (counters.get(k) ?? 0) + 1
      counters.set(k, n)
      return JobID.make(`${kind}-${n}`)
    }

    function persistJob(j: Job) {
      try { dbInsert(db, j) } catch (e) { log.warn("job db insert failed", { error: String(e) }) }
    }

    function persistUpdate(j: Job) {
      try { dbUpdate(db, j) } catch (e) { log.warn("job db update failed", { error: String(e) }) }
    }

    const start = Effect.fn("Jobs.start")(function* (input: {
      sessionID: SessionID
      kind: JobKind
      label: string
      run: (signal: AbortSignal, writeOutput: (chunk: string) => void) => Promise<string>
    }) {
      const id = nextID(input.sessionID, input.kind)
      const controller = new AbortController()

      const job: Job = {
        id, kind: input.kind, label: input.label, sessionID: input.sessionID,
        status: "running", output: `[started] ${input.label}`, result: "", resultSurfaced: false,
        startedAt: Date.now(), finishedAt: 0,
        cancel: () => controller.abort(),
      }

      const jobKey = key(input.sessionID, id)
      jobs.set(jobKey, job)
      persistJob(job)
      log.info("job started", { id, kind: input.kind, sessionID: input.sessionID })

      void Effect.gen(function* () {
        try {
          const writeOutput = (chunk: string) => {
            const j = jobs.get(jobKey)
            if (j) { j.output += chunk; persistUpdate(j) }
          }
          const result = yield* Effect.tryPromise({
            try: () => input.run(controller.signal, writeOutput),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          })
          const j = jobs.get(jobKey)
          if (j) {
            if (controller.signal.aborted) { j.status = "killed" }
            else { j.status = "done"; if (input.kind === "task") j.result = result }
            j.finishedAt = Date.now()
            persistUpdate(j)
            log.info("job completed", { id, status: j.status })
          }
        } catch (err) {
          const j = jobs.get(jobKey)
          if (j) {
            if (controller.signal.aborted) { j.status = "killed" }
            else { j.status = "failed" }
            j.finishedAt = Date.now()
            persistUpdate(j)
            log.warn("job failed", { id, error: String(err) })
          }
        }
        const j = jobs.get(jobKey)
        if (j) {
          completed.push({
            sessionID: input.sessionID,
            text: `${j.id} (${j.label}) → ${j.status}${j.result ? `: ${j.result.slice(0, 100)}` : ""}`,
          })
        }
      }).pipe(Effect.runFork)

      return id
    })

    const output = Effect.fn("Jobs.output")(function* (input: { sessionID: SessionID; jobID: JobID }) {
      const j = jobs.get(key(input.sessionID, input.jobID))
      if (!j) return { text: "", status: "failed" as JobStatus }
      const offsetKey = key(input.sessionID, input.jobID) + ":offset"
      const offset = readOffsets.get(offsetKey) ?? 0
      const text = j.output.slice(offset)
      readOffsets.set(offsetKey, offset + text.length)
      if (text === "" && j.status !== "running" && j.result !== "" && !j.resultSurfaced) {
        j.resultSurfaced = true
        return { text: j.result, status: j.status }
      }
      return { text, status: j.status }
    })

    const kill = Effect.fn("Jobs.kill")(function* (input: { sessionID: SessionID; jobID: JobID }) {
      const j = jobs.get(key(input.sessionID, input.jobID))
      if (!j || j.status !== "running") return false
      j.cancel()
      j.status = "killed"
      j.finishedAt = Date.now()
      persistUpdate(j)
      return true
    })

    const list = Effect.fn("Jobs.list")(function* (input: { sessionID: SessionID }) {
      const result: JobInfo[] = []
      for (const [k, j] of jobs) {
        if (!k.startsWith(input.sessionID + "\x00")) continue
        result.push({ id: j.id, kind: j.kind, label: j.label, status: j.status, startedAt: j.startedAt })
      }
      return result
    })

    const drainCompletedNote = Effect.fn("Jobs.drainCompletedNote")(function* (input: { sessionID: SessionID }) {
      const notes: string[] = []
      for (let i = completed.length - 1; i >= 0; i--) {
        if (completed[i].sessionID === input.sessionID) {
          notes.push(completed[i].text)
          completed.splice(i, 1)
        }
      }
      // Clean up completed rows from DB for this session
      if (notes.length > 0) {
        try {
          db.run("DELETE FROM job WHERE session_id = ? AND status != 'running'", [input.sessionID])
        } catch (e) { log.warn("job db cleanup failed", { error: String(e) }) }
      }
      if (notes.length === 0) return ""
      return (
        "Background jobs since your last turn: " +
        notes.reverse().join("; ") +
        ". Use job_output to read their output, or job_wait if you still need them."
      )
    })

    const startEffect = Effect.fn("Jobs.startEffect")(function* (input: {
      sessionID: SessionID
      kind: JobKind
      label: string
      run: Effect.Effect<string, Error>
    }) {
      const id = nextID(input.sessionID, input.kind)
      const controller = new AbortController()

      const job: Job = {
        id, kind: input.kind, label: input.label, sessionID: input.sessionID,
        status: "running", output: `[started] ${input.label}`, result: "", resultSurfaced: false,
        startedAt: Date.now(), finishedAt: 0,
        cancel: () => controller.abort(),
      }

      const jobKey = key(input.sessionID, id)
      jobs.set(jobKey, job)
      persistJob(job)
      log.info("job started (effect)", { id, kind: input.kind, sessionID: input.sessionID })

      yield* Effect.promise(() => acquire())

      input.run.pipe(
        Effect.tap((text) => Effect.sync(() => {
          const j = jobs.get(jobKey)
          if (j) {
            j.output = j.output.replace(/^\[started\].*\n?/, "") + text + "\n"
            persistUpdate(j)
          }
        })),
        Effect.matchEffect({
          onSuccess: (result) => Effect.sync(() => {
            const j = jobs.get(jobKey)
            if (!j) return
            if (controller.signal.aborted) { j.status = "killed" }
            else { j.status = "done"; j.result = result }
            if (!j.output.includes("[started]")) j.output = result
            j.finishedAt = Date.now()
            persistUpdate(j)
            completed.push({
              sessionID: input.sessionID,
              text: `${j.id} (${j.label}) → ${j.status}${j.result ? `: ${j.result.slice(0, 100)}` : ""}`,
            })
            log.info("job completed (effect)", { id, status: j.status })
          }),
          onFailure: (err) => Effect.sync(() => {
            const j = jobs.get(jobKey)
            if (!j) return
            if (controller.signal.aborted) { j.status = "killed" }
            else { j.status = "failed"; j.output += `\nError: ${err.message}` }
            j.finishedAt = Date.now()
            persistUpdate(j)
            completed.push({ sessionID: input.sessionID, text: `${j.id} (${j.label}) → failed` })
            log.warn("job failed (effect)", { id, error: err.message })
          }),
        }),
        Effect.ensuring(Effect.sync(() => release())),
        Effect.runFork,
      )

      return id
    })

    return Service.of({ start, startEffect, output, kill, list, drainCompletedNote })
  }),
)

export const defaultLayer = layer

export * as Jobs from "./index"
