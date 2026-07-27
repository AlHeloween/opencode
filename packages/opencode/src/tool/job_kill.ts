import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Jobs } from "../jobs"

export const JobKillParameters = Schema.Struct({
  job_id: Schema.String.annotate({ description: "The job ID to kill (e.g. bash-1, task-2)" }),
})

/**
 * Kill a running or stalled background job.
 *
 * The agent uses this when a job is taking too long or appears to be hung.
 * After killing, the job status transitions to "killed" and any buffered
 * output is preserved for reading via job_output.
 */
export const JobKillTool = Tool.define(
  "job_kill",
  Effect.gen(function* () {
    const jobs = yield* Jobs.Service
    return {
      description:
        "Kill a running or stalled background job. Use this when a job is taking too long (stalled) or no longer needed. The job's output up to the kill point is preserved and can be read with joboutput.",
      parameters: JobKillParameters,
      execute: (params: { job_id: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const killed = yield* jobs.kill({ sessionID: ctx.sessionID, jobID: Jobs.JobID.make(params.job_id) })
          if (killed) {
            return {
              title: `Killed job ${params.job_id}`,
              output: `Job ${params.job_id} has been killed. Use joboutput to read any output produced before termination.`,
              metadata: { jobID: params.job_id, killed: true },
            }
          }
          return {
            title: `Job ${params.job_id} not killed`,
            output: `Job ${params.job_id} was not running (already done, failed, or not found). Nothing to kill.`,
            metadata: { jobID: params.job_id, killed: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
