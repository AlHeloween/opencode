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
      description: "Read output from a background job. Returns any new output since the last read, plus the job's current status (running, done, failed, killed).",
      parameters: JobOutputParameters,
      execute: (params: { job_id: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* jobs.output({ sessionID: ctx.sessionID, jobID: params.job_id as any })
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
})

export const JobWaitTool = Tool.define(
  "job_wait",
  Effect.gen(function* () {
    const jobs = yield* Jobs.Service
    return {
      description: "Wait for background jobs to complete. Blocks until all specified jobs reach a terminal state (done, failed, or killed), then returns their final output.",
      parameters: JobWaitParameters,
      execute: (params: { job_ids?: string[]; timeout?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ids = params.job_ids ?? []
          const maxWait = params.timeout ?? 30000
          const start = Date.now()

          // Poll until all jobs are done or timeout
          while (Date.now() - start < maxWait) {
            const list = yield* jobs.list({ sessionID: ctx.sessionID })
            const targetIds = ids.length > 0 ? ids : list.map((j) => j.id)
            const running = list.filter((j) => targetIds.includes(j.id) && j.status === "running")

            if (running.length === 0) break
            yield* Effect.sleep(500)
          }

          // Collect results
          const results: string[] = []
          const list = yield* jobs.list({ sessionID: ctx.sessionID })
          const targetIds = ids.length > 0 ? ids : list.map((j) => j.id)
          for (const jobId of targetIds) {
            const out = yield* jobs.output({ sessionID: ctx.sessionID, jobID: jobId as any })
            const info = list.find((j) => j.id === jobId)
            results.push(`${jobId} (${info?.status ?? "unknown"}): ${out.text.slice(0, 500) || "(no output)"}`)
          }

          return {
            title: "Background jobs",
            output: results.join("\n\n") || "No jobs found.",
            metadata: { jobIDs: targetIds },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
