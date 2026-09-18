import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Jobs } from "../jobs"

export const JobResetParameters = Schema.Struct({
  job_id: Schema.String.annotate({ description: "The job ID to extend (e.g. bash-1, task-2)" }),
})

/**
 * Reset the stall deadline of a running background job.
 *
 * The jobs heartbeat warns when a job has produced no output for a while
 * ("⚠ <id> … potentially stalled; will be killed in Ns unless reset") and kills
 * it when the deadline expires. A long job that is legitimately silent (test
 * suites, builds, downloads) must be re-armed by the agent: call this after the
 * warning to buy a fresh window. Only the agent can tell "slow" from "hung" —
 * the heartbeat cannot (2026-09-18, Alexander).
 */
export const JobResetTool = Tool.define(
  "jobreset",
  Effect.gen(function* () {
    const jobs = yield* Jobs.Service
    return {
      description:
        "Reset the stall deadline of a running/stalled background job so it is not auto-killed. Call this after a stall warning when the job is legitimately long (builds, test suites, downloads); it does not touch the job's output or result.",
      parameters: JobResetParameters,
      execute: (params: { job_id: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const reset = yield* jobs.reset({ sessionID: ctx.sessionID, jobID: Jobs.JobID.make(params.job_id) })
          if (reset) {
            return {
              title: `Reset stall deadline for ${params.job_id}`,
              output: `Job ${params.job_id} stall deadline reset — the auto-kill clock restarts; the job keeps running.`,
              metadata: { jobID: params.job_id, reset: true },
            }
          }
          return {
            title: `Job ${params.job_id} not reset`,
            output: `Job ${params.job_id} is not running (already done, failed, or killed). Nothing to reset.`,
            metadata: { jobID: params.job_id, reset: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "job_reset",
)
