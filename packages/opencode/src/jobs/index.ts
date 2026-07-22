import { Effect, Context, Fiber, Layer, Schema } from "effect"
import { SessionID } from "../session/schema"
import { EffectBridge } from "@/effect/bridge"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "bun:sqlite"
import path from "path"
import { existsSync, mkdirSync } from "fs"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import type { InfoMark } from "../session/constitution"

const log = Log.create({ service: "jobs" })

const JobsUpdated = BusEvent.define(
  "jobs.updated",
  Schema.Struct({
    sessionID: SessionID,
    jobs: Schema.mutable(Schema.Array(Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      label: Schema.String,
      status: Schema.String,
      startedAt: Schema.Number,
      output: Schema.String,
    }))),
  }),
)

/** Unique job identifier: "bash-3" or "task-1" */
export const JobID = Schema.String.pipe(Schema.brand("JobID"))
export type JobID = Schema.Schema.Type<typeof JobID>

export const JobStatus = Schema.Literals(["running", "stalled", "done", "failed", "killed"])
export type JobStatus = Schema.Schema.Type<typeof JobStatus>

export const JobKind = Schema.Literals(["bash", "task", "run", "cmd"])
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
  lastOutputAt: number
  cancel: () => void
}

interface Completion {
  sessionID: SessionID
  text: string
  /** Epistemic rank of the completion:
    * "Exact" for bash/cmd/run (tool output is ground truth),
    * "Inferred" for task (sub-agent conclusion, not verified). */
  infoMark: InfoMark
}

function infoMarkForKind(kind: JobKind): InfoMark {
  return kind === "task" ? "Inferred" : "Exact"
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
    /** Effect that runs the job. Receives a `writeOutput` callback for incremental output streaming. */
    run: (writeOutput: (chunk: string) => void) => Effect.Effect<string, Error>
  }) => Effect.Effect<JobID>

  /** Write incremental output to a running job. Used for streaming progress from within the job's effect. */
  readonly write: (input: { sessionID: SessionID; jobID: JobID; chunk: string }) => Effect.Effect<void>

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
    try { _jobsDb.close() } catch (e) { log.debug("jobs db close failed", { error: String(e) }) }
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
    const MAX_JOBS = 1000
    const JOB_TTL = 30 * 60 * 1000 // 30 minutes
    const jobs = new Map<string, Job>()
    const completed: Completion[] = []
    const readOffsets = new Map<string, number>()
    const counters = new Map<string, number>()

    function evictStaleJobs() {
      const now = Date.now()
      // TTL eviction: remove jobs older than JOB_TTL
      for (const [id, job] of jobs) {
        if (now - job.startedAt > JOB_TTL) {
          jobs.delete(id)
          readOffsets.delete(id + ":offset")
        }
      }
      // Enforce max size: remove oldest entries if over limit
      if (jobs.size > MAX_JOBS) {
        const entries = [...jobs.entries()]
        entries.sort((a, b) => a[1].startedAt - b[1].startedAt)
        const toDelete = entries.slice(0, entries.length - MAX_JOBS)
        for (const [id] of toDelete) {
          jobs.delete(id)
          readOffsets.delete(id + ":offset")
        }
      }
      // Clean counters for sessions with no remaining jobs
      const activeSessions = new Set<string>()
      for (const [jk] of jobs) {
        const sep = jk.indexOf("\x00")
        if (sep > 0) activeSessions.add(jk.slice(0, sep))
      }
      for (const [ck] of counters) {
        const sep = ck.indexOf("\x00")
        if (sep > 0 && !activeSessions.has(ck.slice(0, sep))) counters.delete(ck)
      }
    }

    // Initialize jobs DB
    const db = getJobsDb()

    // Heartbeat: detect stalled background jobs.
    // A job is "stalled" when it's been running for >15s without producing output.
    // The agent sees stalled status via job_output / job_wait and can decide to
    // kill it with job_kill.
    const STALL_THRESHOLD_MS = 15_000
    const HEARTBEAT_INTERVAL_MS = 5_000
    const stallCheck = setInterval(() => {
      for (const [, j] of jobs) {
        if (j.status === "running" && Date.now() - j.lastOutputAt > STALL_THRESHOLD_MS) {
          j.status = "stalled"
          log.info("job stalled", { id: j.id, kind: j.kind, elapsed: Date.now() - j.startedAt })
          try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("stall persist failed", { error: String(e) }) }
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
    // Clean up heartbeat on scope disposal
    yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(stallCheck)))

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

    /** Fire-and-forget publish of job state to TUI subscribers. */
    function publishJobs(sessionID: SessionID) {
      const list: Array<{ id: string; kind: string; label: string; status: string; startedAt: number; output: string }> = []
      for (const [k, j] of jobs) {
        if (!k.startsWith(sessionID + "\x00")) continue
        list.push({ id: j.id, kind: j.kind, label: j.label, status: j.status, startedAt: j.startedAt, output: j.output })
      }
      void Bus.publish(JobsUpdated, { sessionID, jobs: list }).catch((e) => { log.debug("jobs publish failed", { error: String(e) }) })
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
        startedAt: Date.now(), finishedAt: 0, lastOutputAt: Date.now(),
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
            if (j) { j.output += chunk; j.lastOutputAt = Date.now(); persistUpdate(j); publishJobs(j.sessionID) }
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
            publishJobs(j.sessionID)
            log.info("job completed", { id, status: j.status })
          }
        } catch (err) {
          const j = jobs.get(jobKey)
          if (j) {
            if (controller.signal.aborted) { j.status = "killed" }
            else { j.status = "failed" }
            j.finishedAt = Date.now()
            persistUpdate(j)
            publishJobs(j.sessionID)
            log.warn("job failed", { id, error: String(err) })
          }
        }
        const j = jobs.get(jobKey)
        if (j) {
          completed.push({
            sessionID: input.sessionID,
            text: `${j.id} (${j.label}) → ${j.status}${j.result ? `: ${j.result.slice(0, 100)}` : ""}`,
            infoMark: infoMarkForKind(input.kind),
          })
          if (completed.length > 500) completed.shift()
        }
      }).pipe(Effect.runFork)

      return id
    })

    const output = Effect.fn("Jobs.output")(function* (input: { sessionID: SessionID; jobID: JobID }) {
      const j = jobs.get(key(input.sessionID, input.jobID))
      if (!j) {
        log.debug("job_output called for unknown job", { sessionID: input.sessionID, jobID: input.jobID })
        return { text: "", status: "failed" as JobStatus }
      }
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
      if (!j || (j.status !== "running" && j.status !== "stalled")) return false
      j.cancel()
      j.status = "killed"
      j.finishedAt = Date.now()
      persistUpdate(j)
      publishJobs(j.sessionID)
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
      // Evict stale jobs before processing
      evictStaleJobs()

      const notes: { text: string; infoMark: InfoMark }[] = []
      for (let i = completed.length - 1; i >= 0; i--) {
        if (completed[i].sessionID === input.sessionID) {
          notes.push({ text: completed[i].text, infoMark: completed[i].infoMark })
          completed.splice(i, 1)
        }
      }
      if (notes.length === 0) return ""
      const lines = notes.reverse().map((n) => {
        // Insert [Exact]/[Inferred] after the status, before the colon+result.
        // Format: "id (label) → status" or "id (label) → status: result"
        const idx = n.text.indexOf(" → ")
        if (idx === -1) return `  ${n.text} [${n.infoMark}]`
        const afterArrow = n.text.slice(idx + 3)
        const colonIdx = afterArrow.indexOf(": ")
        if (colonIdx === -1) return `  ${n.text} [${n.infoMark}]`
        const status = afterArrow.slice(0, colonIdx)
        const rest = afterArrow.slice(colonIdx + 1)
        return `  ${n.text.slice(0, idx)} → ${status} [${n.infoMark}]: ${rest}`
      })
      return (
        "Background jobs since your last turn:\n" +
        lines.join("\n") +
        "\nUse job_output to read their output, or job_wait if you still need them."
      )
    })

    const write = Effect.fn("Jobs.write")(function* (input: { sessionID: SessionID; jobID: JobID; chunk: string }) {
      const j = jobs.get(key(input.sessionID, input.jobID))
      if (!j) return
      j.output += input.chunk
      j.lastOutputAt = Date.now()
      try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("job write persist failed", { error: String(e) }) }
    })

    const startEffect = Effect.fn("Jobs.startEffect")(function* (input: {
      sessionID: SessionID
      kind: JobKind
      label: string
      run: (writeOutput: (chunk: string) => void) => Effect.Effect<string, Error>
    }) {
      const id = nextID(input.sessionID, input.kind)
      const controller = new AbortController()
      const bridge = yield* EffectBridge.make()
      let fiber: Fiber.Fiber<unknown, unknown> | undefined

      // Incremental output writer — callable from within the job's effect.
      const writeOutput = (chunk: string) => {
        const j = jobs.get(jobKey)
        if (j) {
          // Strip [started] prefix on first real output chunk
          if (j.output.startsWith("[started]")) {
            j.output = chunk
          } else {
            j.output += chunk
          }
          j.lastOutputAt = Date.now()
          try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("job write persist failed", { error: String(e) }) }
        }
      }

      const job: Job = {
        id, kind: input.kind, label: input.label, sessionID: input.sessionID,
        status: "running", output: `[started] ${input.label}`, result: "", resultSurfaced: false,
        startedAt: Date.now(), finishedAt: 0, lastOutputAt: Date.now(),
        cancel: () => {
          controller.abort()
          if (fiber) bridge.fork(Fiber.interrupt(fiber))
        },
      }

      const jobKey = key(input.sessionID, id)
      jobs.set(jobKey, job)
      persistJob(job)
      log.info("job started (effect)", { id, kind: input.kind, sessionID: input.sessionID })

      yield* Effect.promise(() => acquire())

      // Resolve the effect with the writeOutput callback injected.
      const resolvedRun = input.run(writeOutput)

      // Run through EffectBridge so Instance/workspace ALS context is restored.
      // Bare Effect.runFork loses project context and can leave sub-agent sessions
      // stuck after creating an assistant message with no stream events.
      fiber = bridge.fork(
        resolvedRun.pipe(
          Effect.tap((text) => Effect.sync(() => {
            const j = jobs.get(jobKey)
            if (j) {
              // Only append final result if writeOutput was never called (no incremental output)
              if (j.output.startsWith("[started]")) {
                j.output = j.output.replace(/^\[started\].*\n?/, "") + text + "\n"
              } else if (text && !j.output.endsWith(text)) {
                j.output += text + "\n"
              }
              j.lastOutputAt = Date.now()
              try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("job tap persist failed", { error: String(e) }) }
            }
          })),
          Effect.matchEffect({
            onSuccess: (result) => Effect.sync(() => {
              const j = jobs.get(jobKey)
              if (!j) return
              if (controller.signal.aborted) { j.status = "killed" }
              else { j.status = "done"; j.result = result }
              // If no output was written (no writeOutput calls and [started] still present),
              // use the final result as the output.
              if (j.output.startsWith("[started]")) j.output = result
              j.finishedAt = Date.now()
              try { persistUpdate(j) } catch (e) { log.debug("job done persist failed", { error: String(e) }) }
              publishJobs(j.sessionID)
              completed.push({
                sessionID: input.sessionID,
                text: `${j.id} (${j.label}) → ${j.status}${j.result ? `: ${j.result.slice(0, 100)}` : ""}`,
                infoMark: infoMarkForKind(input.kind),
              })
              if (completed.length > 500) completed.shift()
              log.info("job completed (effect)", { id, status: j.status })
            }),
            onFailure: (err) => Effect.sync(() => {
              const j = jobs.get(jobKey)
              if (!j) return
              if (controller.signal.aborted) { j.status = "killed" }
              else { j.status = "failed"; j.output += `\nError: ${err instanceof Error ? err.message : String(err)}` }
              j.finishedAt = Date.now()
              try { persistUpdate(j) } catch (e) { log.debug("job fail persist failed", { error: String(e) }) }
              publishJobs(j.sessionID)
              completed.push({ sessionID: input.sessionID, text: `${j.id} (${j.label}) → failed`, infoMark: infoMarkForKind(input.kind) })
              if (completed.length > 500) completed.shift()
              log.warn("job failed (effect)", { id, error: err instanceof Error ? err.message : String(err) })
            }),
          }),
          Effect.ensuring(Effect.sync(() => release())),
        ),
      )

      return id
    })

    return Service.of({ start, startEffect, write, output, kill, list, drainCompletedNote })
  }),
)

export const defaultLayer = layer

export * as Jobs from "./index"
