import { Effect, Context, Layer, Schema, Stream } from "effect"
import { SessionID } from "../session/schema"
import * as Log from "@opencode-ai/core/util/log"

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
  /** Start a background job. Returns the job ID immediately; the work runs in a forked fiber. */
  readonly start: (input: {
    sessionID: SessionID
    kind: JobKind
    label: string
    /** The work function. Receives an AbortSignal for cancellation.
      * bash jobs should write to the provided writer; task jobs should return their final answer. */
    run: (signal: AbortSignal, writeOutput: (chunk: string) => void) => Promise<string>
  }) => Effect.Effect<JobID>

  /** Read incremental output from a job. Returns the output since last read. */
  readonly output: (input: { sessionID: SessionID; jobID: JobID }) => Effect.Effect<{ text: string; status: JobStatus }>

  /** Kill a running job. Returns true if the job was running and is now killed. */
  readonly kill: (input: { sessionID: SessionID; jobID: JobID }) => Effect.Effect<boolean>

  /** List all jobs for a session. */
  readonly list: (input: { sessionID: SessionID }) => Effect.Effect<JobInfo[]>

  /** Drain completion notes for a session. Returns text to inject into the next turn, or empty string. */
  readonly drainCompletedNote: (input: { sessionID: SessionID }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Jobs") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // In-memory job store keyed by "sessionID\x00jobID"
    const jobs = new Map<string, Job>()
    // Completion notes queued by the run goroutine
    const completed: Completion[] = []
    // Per-session read offsets for incremental output
    const readOffsets = new Map<string, number>()
    // Sequential counter per kind per session
    const counters = new Map<string, number>()

    function key(sessionID: SessionID, jobID: JobID) {
      return `${sessionID}\x00${jobID}`
    }

    function nextID(sessionID: SessionID, kind: JobKind): JobID {
      const k = `${sessionID}\x00${kind}`
      const n = (counters.get(k) ?? 0) + 1
      counters.set(k, n)
      return JobID.make(`${kind}-${n}`)
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
        id,
        kind: input.kind,
        label: input.label,
        sessionID: input.sessionID,
        status: "running",
        output: "",
        result: "",
        resultSurfaced: false,
        startedAt: Date.now(),
        finishedAt: 0,
        cancel: () => controller.abort(),
      }

      const jobKey = key(input.sessionID, id)
      jobs.set(jobKey, job)

      log.info("job started", { id, kind: input.kind, sessionID: input.sessionID })

      // Run the job in a forked fiber
      void Effect.gen(function* () {
        try {
          const writeOutput = (chunk: string) => {
            const j = jobs.get(jobKey)
            if (j) j.output += chunk
          }

          const result = yield* Effect.tryPromise({
            try: () => input.run(controller.signal, writeOutput),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          })

          const j = jobs.get(jobKey)
          if (j) {
            if (controller.signal.aborted) {
              j.status = "killed"
            } else {
              j.status = "done"
              if (input.kind === "task") j.result = result
            }
            j.finishedAt = Date.now()
            log.info("job completed", { id, status: j.status })
          }
        } catch (err) {
          const j = jobs.get(jobKey)
          if (j) {
            if (controller.signal.aborted) {
              j.status = "killed"
            } else {
              j.status = "failed"
            }
            j.finishedAt = Date.now()
            log.warn("job failed", { id, error: String(err) })
          }
        }

        // Queue completion note
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

      // For task jobs, surface the result if no new output and job is done
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
      if (notes.length === 0) return ""
      return (
        "Background jobs since your last turn: " +
        notes.reverse().join("; ") +
        ". Use job_output to read their output, or job_wait if you still need them."
      )
    })

    return Service.of({ start, output, kill, list, drainCompletedNote })
  }),
)

export const defaultLayer = layer

export * as Jobs from "./index"
