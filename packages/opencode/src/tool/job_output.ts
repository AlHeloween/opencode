import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Jobs } from "../jobs"

export const JobOutputParameters = Schema.Struct({
  job_id: Schema.String.annotate({ description: "The job ID (e.g. bash-1, task-2)" }),
})

export const JobOutputTool = Tool.define(
  "job_output",
  Effect.gen(function* () {
    const jobs = yield* Jobs.Service
    return {
      description: "Read output from a background job. Returns any new output since the last read, plus the job's current status (running, stalled, done, failed, killed). Stalled means no output for 15s — the agent should consider killing it with jobkill.",
      parameters: JobOutputParameters,
      execute: (params: { job_id: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* jobs.output({ sessionID: ctx.sessionID, jobID: Jobs.JobID.make(params.job_id) })
          if (result.text === "" && result.status !== "running") {
            return {
              title: `Job ${params.job_id} (${result.status})`,
              output: `Job ${params.job_id} is ${result.status}. No new output.`,
              metadata: { jobID: params.job_id, status: result.status },
            }
          }
          return {
            title: `Job ${params.job_id} output`,
            output: result.text || `(no output, status: ${result.status})`,
            metadata: { jobID: params.job_id, status: result.status },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const JobWaitParameters = Schema.Struct({
  job_ids: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Job IDs to wait for. If empty, waits for all running jobs in this session.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Maximum wait time in milliseconds (default: 30000)",
  }),
  progress_interval_ms: Schema.optional(Schema.Number).annotate({
    description:
      "When set, returns every N milliseconds with intermediate progress instead of blocking until completion. The model can then decide to continue (call jobwait again), kill (jobkill), or take other action. Use for long-running tasks (compiles, deploys) where the model needs periodic control. Without this, jobwait blocks until all jobs finish or timeout fires.",
  }),
})

export const JobWaitTool = Tool.define(
  "job_wait",
  Effect.gen(function* () {
    const jobs = yield* Jobs.Service
    return {
      description:
        "Wait for background jobs to complete. Blocks until all specified jobs reach a terminal state (done, failed, or killed), then returns their final output. Set progress_interval_ms for periodic progress returns on long-running tasks.",
      parameters: JobWaitParameters,
      execute: (params: { job_ids?: string[]; timeout?: number; progress_interval_ms?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ids = params.job_ids ?? []
          const maxWait = params.timeout ?? 30000
          const progressInterval = params.progress_interval_ms
          const start = Date.now()
          let intervalStart = Date.now()

          // Poll until all jobs are done/failed/killed, timeout, or progress interval fires.
          // Stalled jobs are NOT terminal — agent must decide to kill them.
          while (Date.now() - start < maxWait) {
            const list = yield* jobs.list({ sessionID: ctx.sessionID })
            const targetIds = ids.length > 0 ? ids : list.map((j) => j.id)
            const pending = list.filter((j) =>
              targetIds.includes(j.id) && (j.status === "running" || j.status === "stalled")
            )

            if (pending.length === 0) break

            // Progress interval: return control to the model for decision-making
            if (progressInterval && Date.now() - intervalStart >= progressInterval) break

            yield* Effect.sleep(500)
          }

          // Collect results — including intermediate status for still-running jobs
          const results: string[] = []
          const list = yield* jobs.list({ sessionID: ctx.sessionID })
          const targetIds = ids.length > 0 ? ids : list.map((j) => j.id)
          const now = Date.now()
          let stillRunning = false

          for (const jobId of targetIds) {
            const out = yield* jobs.output({ sessionID: ctx.sessionID, jobID: Jobs.JobID.make(jobId) })
            const info = list.find((j) => j.id === jobId)
            const status = info?.status ?? "unknown"
            const elapsed = info ? Math.round((now - info.startedAt) / 1000) : 0
            const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`

            if (status === "running" || status === "stalled") {
              stillRunning = true
              results.push(
                `${jobId} (${status}, ${elapsedStr} elapsed): ${out.text.slice(0, 500) || "(no output yet)"}`,
              )
            } else {
              results.push(`${jobId} (${status}): ${out.text.slice(0, 500) || "(no output)"}`)
            }
          }

          let output = results.join("\n\n") || "No jobs found."
          if (stillRunning && progressInterval) {
            output +=
              `\n\n[progress tick — jobs still running. Call jobwait again to continue waiting, or jobkill to abort.]`
          }

          return {
            title: "Background jobs",
            output,
            metadata: { jobIDs: targetIds },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
