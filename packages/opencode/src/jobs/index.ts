import { Effect, Context, Fiber, Layer, Schema } from "effect"
import { SessionID } from "../session/schema"
import { EffectBridge } from "@/effect/bridge"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "bun:sqlite"
import path from "path"
import { existsSync, mkdirSync } from "fs"
import { exec } from "node:child_process"
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

// ── Stall window (module scope so tests can shrink it) ────────────────────────
// A job is "stalled" when it has produced no output for `stallThresholdMs`.
// The heartbeat then warns the agent (cpu + remaining seconds) and kills the
// job `stallKillMs` after max(lastOutputAt, stallResetAt) unless the agent
// calls `jobreset` (2026-09-18, Alexander: a job may be legitimately long OR
// genuinely hung — only the agent can tell).
let stallThresholdMs = 15_000
let stallKillMs = 120_000
let stallHeartbeatMs = 5_000

/** @internal test hook — shrink the stall window (heartbeat) for tests. */
export function setStallThresholdsForTests(
  value: { stallMs?: number; killMs?: number; heartbeatMs?: number } | undefined,
): void {
  stallThresholdMs = value?.stallMs ?? 15_000
  stallKillMs = value?.killMs ?? 120_000
  stallHeartbeatMs = value?.heartbeatMs ?? 5_000
}

/**
 * Best-effort CPU reading for a pid: total CPU seconds on win32
 * (`Get-Process`), percent on POSIX (`ps`). Returns "n/a" when the sample
 * fails — a missing reading must never break the heartbeat.
 */
async function sampleCpu(pid: number): Promise<string> {
  try {
    const { execFile } = await import("node:child_process")
    const stdout = await new Promise<string>((resolve, reject) => {
      const args =
        process.platform === "win32"
          ? ["-NoProfile", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).CPU`]
          : ["-o", "pcpu=", "-p", String(pid)]
      execFile(
        process.platform === "win32" ? "powershell" : "ps",
        args,
        { timeout: 2000, windowsHide: true },
        (err, out) => (err ? reject(err) : resolve(String(out))),
      )
    })
    const value = Number.parseFloat(stdout.trim())
    if (!Number.isFinite(value)) return "n/a"
    return process.platform === "win32" ? `${value.toFixed(1)}s` : `${value.toFixed(1)}%`
  } catch (e) {
    log.debug("cpu sample failed", { pid, error: String(e) })
    return "n/a"
  }
}

let cpuSampler: (pid: number) => Promise<string> = sampleCpu

/** @internal test hook — replace the CPU sampler. */
export function setCpuSamplerForTests(fn: ((pid: number) => Promise<string>) | undefined): void {
  cpuSampler = fn ?? sampleCpu
}

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
  /** Root child pid, attached by the spawning tool (`self.setPid`). Enables a
   *  CPU reading in stall warnings and an explicit tree kill that does not
   *  depend on the fiber interrupt (2026-09-18). */
  pid?: number
  /** Process id of the runtime that created this job. `jobs.db` is per-worktree
   *  and therefore SHARED by every runtime in that worktree, so boot recovery
   *  needs the owner to tell "a dead runtime's orphan" from "a live neighbour's
   *  job still in memory" (2026-09-18). */
  ownerPid: number
  /** Deadline base for the stall kill: set by `reset` so a reset buys a fresh
   *  window. Kill fires at max(lastOutputAt, stallResetAt) + stallKillMs. */
  stallResetAt?: number
  /** Set when the stall warning for the current episode was emitted (one per
   *  episode; cleared by reset). */
  stallWarnedAt?: number
  /** Last sampled CPU reading, shown in stall warnings and notes. */
  cpuText?: string
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
    /** Effect that runs the job. Receives a `writeOutput` callback for incremental
     *  output streaming and a `self` handle (id + setPid) for stall/kill plumbing. */
    run: (
      writeOutput: (chunk: string) => void,
      self: { readonly id: JobID; setPid: (pid: number) => void },
    ) => Effect.Effect<string, Error>
  }) => Effect.Effect<JobID>

  /** Write incremental output to a running job. Used for streaming progress from within the job's effect. */
  readonly write: (input: { sessionID: SessionID; jobID: JobID; chunk: string }) => Effect.Effect<void>

  readonly output: (input: { sessionID: SessionID; jobID: JobID; pattern?: string }) => Effect.Effect<{ text: string; status: JobStatus }>

  readonly kill: (input: { sessionID: SessionID; jobID: JobID }) => Effect.Effect<boolean>

  /** Reset the stall deadline of a running/stalled job (the job keeps running).
   *  The agent calls this after a stall warning when the job is legitimately
   *  long; without it the heartbeat kills the job at the deadline. */
  readonly reset: (input: { sessionID: SessionID; jobID: JobID }) => Effect.Effect<boolean>

  readonly list: (input: { sessionID: SessionID }) => Effect.Effect<JobInfo[]>

  readonly drainCompletedNote: (input: { sessionID: SessionID }) => Effect.Effect<string>
  /** Combined note: completed + running jobs with CPU usage warning. */
  readonly drainBackgroundNote: (input: { sessionID: SessionID }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Jobs") {}

// ── Orphan / zombie kill guards (2026-09-18) ─────────────────────────────────
// A job's root child is attached within seconds of `startedAt`, so a pid we
// recorded is still OURS only if the live process with that pid started at
// ≈ startedAt. Windows reuses pids, and `taskkill /pid <reused> /T /F` would
// take down an innocent process — so every re-kill is gated on this probe.
// FAIL-SAFE: an unreadable probe means DO NOT kill (safety > task).

/** .NET ticks at the Unix epoch: `DateTime.Ticks` counts 100 ns from 0001-01-01. */
const DOTNET_EPOCH_MS = 62135596800000
/** Generous window between a job record and its root child. */
const PID_MATCH_WINDOW_MS = 60_000

/** Is a process with this pid alive? EPERM means alive but not signalable. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Start time (ms since epoch, UTC) per pid, in ONE probe. Windows-only — the
 * tree kill is Windows-only too, and on POSIX the process group is addressed
 * directly. Returns an empty map on POSIX or when the probe fails; callers
 * treat a missing entry as "not ours".
 *
 * `ToUniversalTime()` is REQUIRED, not cosmetic: `Process.StartTime` is a
 * LOCAL DateTime, so its raw `.Ticks` differ from the UTC epoch by the machine's
 * offset — comparing those against `Date.now()` would put every pid ~8 h
 * outside the window and the guard would silently never fire (measured
 * 2026-09-18: raw ticks gave delta −28 799 352 ms = exactly −8 h; converted,
 * delta 520 ms).
 */
async function processStartTimes(pids: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  if (pids.length === 0 || process.platform !== "win32") return result
  try {
    const { execFile } = await import("node:child_process")
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.StartTime.ToUniversalTime().Ticks)" }`,
        ],
        { timeout: 5_000, windowsHide: true },
        (err, out) => (err ? reject(err) : resolve(String(out))),
      )
    })
    for (const line of stdout.split("\n")) {
      const [id, ticks] = line.trim().split(/\s+/)
      const pid = Number.parseInt(id ?? "", 10)
      const t = Number.parseInt(ticks ?? "", 10)
      if (!Number.isFinite(pid) || !Number.isFinite(t)) continue
      result.set(pid, Math.round(t / 10_000) - DOTNET_EPOCH_MS)
    }
  } catch (e) {
    log.debug("process start-time probe failed", { pids, error: String(e) })
  }
  return result
}

/** True only when the live pid is the process this job spawned. */
function isPidOurs(pid: number, startedAt: number, starts: Map<number, number>): boolean {
  const start = starts.get(pid)
  if (start === undefined) return false
  return Math.abs(start - startedAt) <= PID_MATCH_WINDOW_MS
}

/**
 * Kill a pid's whole process tree. On Windows `taskkill /T` must run while the
 * root is still alive (a dead root cannot be walked) — hence killing by the
 * recorded pid rather than after the fiber died. On POSIX the process group is
 * signalled instead.
 */
function killTreePid(pid: number): void {
  if (!pid) return
  try {
    if (process.platform === "win32") {
      exec(`taskkill /pid ${pid} /T /F`, { windowsHide: true }, (err) => {
        if (err) log.debug("kill tree taskkill failed", { pid, error: String(err) })
      })
    } else {
      try {
        process.kill(-pid, "SIGKILL")
      } catch (e) {
        log.debug("kill tree group failed", { pid, error: String(e) })
      }
    }
  } catch (e) {
    log.debug("kill tree failed", { pid, error: String(e) })
  }
}

/** Guarded re-kill of recovered orphans: probe first, kill only on a match. */
async function killOrphanTrees(
  recovered: Array<{ id: string; pid: number; startedAt: number }>,
): Promise<void> {
  const starts = await processStartTimes(recovered.map((r) => r.pid))
  for (const r of recovered) {
    if (!isPidOurs(r.pid, r.startedAt, starts)) {
      log.warn("orphan tree NOT killed — pid no longer matches its job (pid reuse)", { id: r.id, pid: r.pid })
      continue
    }
    log.info("killing orphan job tree", { id: r.id, pid: r.pid })
    killTreePid(r.pid)
  }
}

/**
 * Boot recovery, instance-aware.
 *
 * `jobs.db` is per-worktree, so EVERY runtime in the worktree shares it. The
 * old recovery flipped every `running` row to `killed`, silently corrupting a
 * live neighbouring runtime's records. Now a row whose `owner_pid` is a live
 * process other than us is left alone — it belongs to that runtime's in-memory
 * map. Only rows whose owner is provably gone are recovered, and only those
 * with an attributable pid get a tree kill (gated by `killOrphanTrees`).
 * Legacy rows (no `owner_pid`) are flipped but never killed: ownership is
 * unverifiable, and acting on an unverified pid is exactly what the guard
 * exists to prevent.
 */
function recoverOrphans(db: Database) {
  const orphans = db
    .query("SELECT id, pid, owner_pid, started_at FROM job WHERE status IN ('running', 'stalled')")
    .all() as Array<{ id: string; pid: number | null; owner_pid: number | null; started_at: number }>
  if (orphans.length === 0) return

  const recovered: Array<{ id: string; pid: number; startedAt: number }> = []
  let skippedLive = 0
  for (const row of orphans) {
    const owner = row.owner_pid
    if (owner != null && owner !== process.pid && isProcessAlive(owner)) {
      skippedLive++
      continue
    }
    db.run("UPDATE job SET status = 'killed', finished_at = ? WHERE id = ?", [Date.now(), row.id])
    if (row.pid != null && owner != null) {
      recovered.push({ id: row.id, pid: row.pid, startedAt: row.started_at })
    }
  }

  if (skippedLive > 0) log.info("orphan recovery left live runtimes' jobs alone", { count: skippedLive })
  if (orphans.length - skippedLive > 0) log.info("orphan jobs recovered", { count: orphans.length - skippedLive })
  // The status flip above is already durable; the tree kill is best-effort and
  // must not hold up this runtime's first job.
  if (recovered.length > 0) void killOrphanTrees(recovered)
}

/** @internal test hook — point jobs.db at a temp path and force a reopen. */
export function setJobsDbPathForTests(p: string | undefined): void {
  try { _jobsDb?.close() } catch (e) { log.debug("jobs db close failed", { error: String(e) }) }
  _jobsDb = undefined
  _jobsDbPath = undefined
  jobsDbPathOverride = p
}

let jobsDbPathOverride: string | undefined

/** Get the jobs.db path — same folder as the main opencode.db */
function getJobsDbPath(): string {
  if (jobsDbPathOverride) return jobsDbPathOverride
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
      finished_at INTEGER NOT NULL DEFAULT 0,
      pid INTEGER,
      owner_pid INTEGER
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS job_session_idx ON job (session_id)")

  // Migrate DBs created before pid/owner_pid existed (2026-09-18).
  const columns = new Set(
    (db.query("PRAGMA table_info(job)").all() as Array<{ name: string }>).map((c) => c.name),
  )
  if (!columns.has("pid")) db.run("ALTER TABLE job ADD COLUMN pid INTEGER")
  if (!columns.has("owner_pid")) db.run("ALTER TABLE job ADD COLUMN owner_pid INTEGER")

  recoverOrphans(db)

  _jobsDb = db
  _jobsDbPath = dbPath
  return db
}

function dbInsert(sqldb: Database, j: Job) {
  sqldb.run(
    `INSERT OR REPLACE INTO job (id, session_id, kind, label, status, output, result, started_at, finished_at, pid, owner_pid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [j.id, j.sessionID, j.kind, j.label, j.status, j.output, j.result, j.startedAt, j.finishedAt, j.pid ?? null, j.ownerPid],
  )
}

function dbUpdate(sqldb: Database, j: Job) {
  sqldb.run(
    `UPDATE job SET status = ?, output = ?, result = ?, finished_at = ?, pid = ? WHERE id = ?`,
    [j.status, j.output, j.result, j.finishedAt, j.pid ?? null, j.id],
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
      // TTL eviction: remove jobs older than JOB_TTL.
      // Cancel any still-running job before map eviction to avoid orphaned OS processes.
      for (const [id, job] of jobs) {
        if (now - job.startedAt > JOB_TTL) {
          if (job.status === "running" || job.status === "stalled") {
            job.cancel()
            job.status = "killed"
            job.finishedAt = Date.now()
            persistUpdate(job)
            log.warn("bug: evicting live job via TTL — possible zombie", { id: job.id, kind: job.kind, elapsed: now - job.startedAt })
          }
          jobs.delete(id)
          readOffsets.delete(id + ":offset")
        }
      }
      // Enforce max size: remove oldest entries if over limit.
      if (jobs.size > MAX_JOBS) {
        const entries = [...jobs.entries()]
        entries.sort((a, b) => a[1].startedAt - b[1].startedAt)
        const toDelete = entries.slice(0, entries.length - MAX_JOBS)
        for (const [id, job] of toDelete) {
          if (job.status === "running" || job.status === "stalled") {
            job.cancel()
            job.status = "killed"
            job.finishedAt = Date.now()
            persistUpdate(job)
            log.warn("bug: evicting live job via MAX_JOBS — possible zombie", { id: job.id, kind: job.kind })
          }
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

    // Agent-facing notices (stall warnings, auto-kills). Drained by
    // drainBackgroundNote so the agent learns WHY a job is at risk / died.
    const notices: { sessionID: SessionID; text: string }[] = []
    function pushNotice(j: Job, text: string) {
      notices.push({ sessionID: j.sessionID, text })
      if (notices.length > 200) notices.shift()
    }

    /**
     * Kill the job's process TREE by its attached pid. Belt and braces next to
     * the fiber interrupt (which releases the spawner scope): a tree whose root
     * already exited cannot be walked by `taskkill /T` any more, so killing by
     * pid while the job is believed alive is the reliable path (2026-09-18: a
     * killed build job kept running as an orphan and wiped dist).
     */
    function killTree(j: Job) {
      if (j.pid) killTreePid(j.pid)
    }

    // Heartbeat: detect stalled background jobs, warn the agent, auto-kill the
    // ones the agent did not vouch for.
    //
    // A job is "stalled" when it produces no output for `stallThresholdMs`.
    // The heartbeat then emits ONE warning per episode — cpu reading + the
    // remaining seconds — and kills the job `stallKillMs` after
    // max(lastOutputAt, stallResetAt) unless the agent calls `jobreset`.
    // A job may be legitimately long (test suites, builds) or genuinely hung;
    // the heartbeat cannot tell, so the deadline is agent-resettable
    // (2026-09-18, Alexander).
    const HEARTBEAT_INTERVAL_MS = stallHeartbeatMs
    const stallCheck = setInterval(() => {
      const now = Date.now()
      for (const [, j] of jobs) {
        const deadlineBase = Math.max(j.lastOutputAt, j.stallResetAt ?? 0)
        const silentFor = now - j.lastOutputAt
        const stalledFor = now - deadlineBase
        if (j.status === "running" && silentFor > stallThresholdMs) {
          j.status = "stalled"
          log.info("job stalled", { id: j.id, kind: j.kind, elapsed: now - j.startedAt })
          try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("stall persist failed", { error: String(e) }) }
        }
        // One warning per stall episode: cpu + deadline + the reset hint.
        if (j.status === "stalled" && j.stallWarnedAt === undefined) {
          j.stallWarnedAt = now
          const remaining = Math.max(0, Math.round((stallKillMs - stalledFor) / 1000))
          const announce = () => {
            pushNotice(
              j,
              `⚠ ${j.id} (${j.label}) silent ${Math.round(silentFor / 1000)}s, cpu ${j.cpuText ?? "n/a"} — potentially stalled; will be killed in ${remaining}s unless reset (jobreset ${j.id})`,
            )
            log.warn("job stall warning", { id: j.id, kind: j.kind, silentFor, remaining })
          }
          if (j.pid) {
            void cpuSampler(j.pid).then((text) => {
              j.cpuText = text
              announce()
            })
          } else announce()
        }
        // Auto-kill: deadline expired and the agent never reset.
        if (j.status === "stalled" && stalledFor > stallKillMs) {
          j.cancel()
          j.status = "killed"
          j.finishedAt = now
          pushNotice(
            j,
            `✖ ${j.id} (${j.label}) auto-killed after ${Math.round(stalledFor / 1000)}s of stall (cpu ${j.cpuText ?? "n/a"}) — no reset received`,
          )
          log.warn("bug: auto-killed stalled job", { id: j.id, kind: j.kind, silentFor, stalledFor, elapsed: now - j.startedAt })
          try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("auto-kill persist failed", { error: String(e) }) }
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
        ownerPid: process.pid,
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

    const output = Effect.fn("Jobs.output")(function* (input: { sessionID: SessionID; jobID: JobID; pattern?: string }) {
      const j = jobs.get(key(input.sessionID, input.jobID))
      if (!j) {
        log.debug("job_output called for unknown job", { sessionID: input.sessionID, jobID: input.jobID })
        return { text: "", status: "failed" as JobStatus }
      }

      // Pattern mode: search FULL accumulated output, don't advance offset.
      // Agents can call joboutput multiple times with different patterns on the same output.
      if (input.pattern) {
        const fullText = j.output
        if (!fullText) return { text: "", status: j.status }
        try {
          const regex = new RegExp(input.pattern, "g")
          const matches = fullText.match(regex)
          if (!matches || matches.length === 0) return { text: "", status: j.status }
          // Return matching lines with context (1 line before and after each match)
          const lines = fullText.split("\n")
          const matchedLines = new Set<number>()
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i]!)) {
              matchedLines.add(i)
              if (i > 0) matchedLines.add(i - 1)
              if (i < lines.length - 1) matchedLines.add(i + 1)
            }
          }
          // Reset regex lastIndex after test() loop
          regex.lastIndex = 0
          const result = [...matchedLines].sort((a, b) => a - b).map((i) => `${i + 1}: ${lines[i]}`).join("\n")
          const capped = result.length > 51200 ? result.slice(0, 51200) + "\n... (truncated)" : result
          return { text: capped, status: j.status }
        } catch {
          // Invalid regex — return empty, don't crash
          return { text: "", status: j.status }
        }
      }

      // Normal mode: incremental read with offset tracking
      const offsetKey = key(input.sessionID, input.jobID) + ":offset"
      const raw = readOffsets.get(offsetKey) ?? 0
      // The buffer is REWRITTEN when the [started] banner is stripped on the
      // first real chunk (writeOutput) or replaced by the final result (tap).
      // A rewritten buffer can be shorter than the read offset — restart from 0
      // instead of slicing past the end, which would hide the whole stream
      // (2026-09-18: streaming made this reachable; before it, the buffer never
      // changed during a run).
      const offset = raw > j.output.length ? 0 : raw
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
      if (!j) return false
      const wasRunning = j.status === "running" || j.status === "stalled"
      if (!wasRunning) {
        // Terminal job: the terminal status is the record of what happened and
        // is never rewritten — but a kill call on a `killed` job is the agent
        // suspecting a ZOMBIE (the process survived its kill, as bash-9 did), so
        // that one case re-attempts a tree kill. Guarded: the pid must still be
        // the process we spawned, or a reused pid would take collateral damage
        // (2026-09-18: the old code flipped the status and returned true for
        // done jobs, contradicting the tool contract and the workflow test).
        if (j.status !== "killed") {
          log.debug("job_kill on terminal job — no-op", { id: j.id, kind: j.kind, status: j.status })
          return false
        }
        const pid = j.pid
        if (!pid) {
          log.warn("job_kill on killed job — no pid recorded, nothing to sweep", { id: j.id, kind: j.kind })
          return false
        }
        const starts = yield* Effect.promise(() => processStartTimes([pid]))
        if (!isPidOurs(pid, j.startedAt, starts)) {
          log.warn("job_kill on killed job — pid gone or reused, nothing to sweep", { id: j.id, pid })
          return false
        }
        log.warn("job_kill re-killing a surviving process tree", { id: j.id, kind: j.kind, pid })
        killTree(j)
        return true
      }
      j.cancel()
      j.status = "killed"
      j.finishedAt = Date.now()
      persistUpdate(j)
      publishJobs(j.sessionID)
      return true
    })

    const reset = Effect.fn("Jobs.reset")(function* (input: { sessionID: SessionID; jobID: JobID }) {
      const j = jobs.get(key(input.sessionID, input.jobID))
      if (!j) return false
      if (j.status !== "running" && j.status !== "stalled") return false
      j.stallResetAt = Date.now()
      j.stallWarnedAt = undefined
      j.status = "running"
      persistUpdate(j)
      publishJobs(j.sessionID)
      log.info("job stall deadline reset", { id: j.id, kind: j.kind })
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

    const drainBackgroundNote = Effect.fn("Jobs.drainBackgroundNote")(function* (input: { sessionID: SessionID }) {
      const completedNote = yield* drainCompletedNote(input)
      const running = Array.from(jobs.entries())
        .filter(([k, j]) => k.startsWith(input.sessionID + "\x00") && (j.status === "running" || j.status === "stalled"))
        .map(([, j]) => j)
      const now = Date.now()
      const runningLines = running.map((j) => {
        if (j.status !== "stalled") {
          return `  ${j.id} (${j.label}) → running [started ${Math.round((now - j.startedAt) / 1000)}s ago]`
        }
        const deadlineBase = Math.max(j.lastOutputAt, j.stallResetAt ?? 0)
        const remaining = Math.max(0, Math.round((stallKillMs - (now - deadlineBase)) / 1000))
        const cpu = j.cpuText ? `, cpu ${j.cpuText}` : ""
        return `  ${j.id} (${j.label}) → stalled [silent ${Math.round((now - j.lastOutputAt) / 1000)}s${cpu}; auto-kill in ${remaining}s — jobreset ${j.id} to extend]`
      })
      const warning = running.length > 0
        ? "\n⚠ CPU: background jobs must stay under 20% total. Avoid launching more if already loaded."
        : ""
      const runningBlock = runningLines.length > 0
        ? "Running background jobs:\n" + runningLines.join("\n")
        : ""
      const noticeLines: string[] = []
      for (let i = notices.length - 1; i >= 0; i--) {
        if (notices[i].sessionID !== input.sessionID) continue
        noticeLines.push(notices[i].text)
        notices.splice(i, 1)
      }
      const noticeBlock = noticeLines.length > 0 ? noticeLines.reverse().join("\n") : ""
      const parts = [completedNote, noticeBlock, runningBlock].filter(Boolean)
      return parts.join("\n") + warning
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
      run: (
        writeOutput: (chunk: string) => void,
        self: { readonly id: JobID; setPid: (pid: number) => void },
      ) => Effect.Effect<string, Error>
    }) {
      const id = nextID(input.sessionID, input.kind)
      const controller = new AbortController()
      const bridge = yield* EffectBridge.make()
      let fiber: Fiber.Fiber<unknown, unknown> | undefined

      // Process priority is set once at startup (index.ts) to BELOW_NORMAL.
      // All background jobs and their children inherit this lowered priority.

      // Incremental output writer — callable from within the job's effect.
      // Memory state (output/lastOutputAt) updates on EVERY chunk: the stall
      // heartbeat reads lastOutputAt, so a throttled update would look like
      // silence. Durable writes + TUI publishes are throttled to ≥500ms —
      // build/test output arrives in hundreds of chunks and a SQLite write per
      // chunk starves the turn (2026-09-18).
      let lastPersistAt = 0
      const writeOutput = (chunk: string) => {
        const j = jobs.get(jobKey)
        if (j) {
          // Strip [started] prefix on first real output chunk. The buffer is
          // REWRITTEN (not appended) — drop the read offset so an agent that
          // already read the banner sees the stream from the start.
          if (j.output.startsWith("[started]")) {
            j.output = chunk
            readOffsets.delete(jobKey + ":offset")
          } else {
            j.output += chunk
          }
          j.lastOutputAt = Date.now()
          const now = Date.now()
          if (now - lastPersistAt < 500) return
          lastPersistAt = now
          try { persistUpdate(j); publishJobs(j.sessionID) } catch (e) { log.debug("job write persist failed", { error: String(e) }) }
        }
      }

      const job: Job = {
        id, kind: input.kind, label: input.label, sessionID: input.sessionID,
        status: "running", output: `[started] ${input.label}`, result: "", resultSurfaced: false,
        startedAt: Date.now(), finishedAt: 0, lastOutputAt: Date.now(),
        ownerPid: process.pid,
        cancel: () => {
          // Tree kill first (belt and braces): a root that already exited can
          // no longer be walked by `taskkill /T`, and the fiber interrupt below
          // only reaches the spawner scope while the tree is still attached.
          killTree(job)
          controller.abort()
          if (fiber) bridge.fork(Fiber.interrupt(fiber))
        },
      }

      const jobKey = key(input.sessionID, id)
      jobs.set(jobKey, job)
      persistJob(job)
      log.info("job started (effect)", { id, kind: input.kind, sessionID: input.sessionID })

      yield* Effect.promise(() => acquire())

      // Resolve the effect with the writeOutput callback and the self handle
      // (id + pid attach) injected.
      const resolvedRun = input.run(writeOutput, {
        id,
        setPid: (pid: number) => {
          const j = jobs.get(jobKey)
          if (!j || j.pid === pid) return
          j.pid = pid
          try { persistUpdate(j) } catch (e) { log.debug("job pid persist failed", { error: String(e) }) }
        },
      })

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
                readOffsets.delete(jobKey + ":offset")
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
              if (j.output.startsWith("[started]")) {
                j.output = result
                readOffsets.delete(jobKey + ":offset")
              }
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
          Effect.ensuring(Effect.sync(() => { release() })),
        ),
      )

      return id
    })

    return Service.of({ start, startEffect, write, output, kill, reset, list, drainCompletedNote, drainBackgroundNote })
  }),
)

export const defaultLayer = layer

export * as Jobs from "./index"
