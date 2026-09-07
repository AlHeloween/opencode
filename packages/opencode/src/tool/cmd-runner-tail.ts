// cmd_runner jobdone auto-tail (2026-09-07, user request).
//
// When a background job runs a `cmd_runner start -- …` command, cmd_runner
// bootstraps the session in its own window and the job's captured output is
// tiny (banner + run_id). The real result lives in the cmd_runner session log
// (logs/cmd_runner/<run_id>/…). On job completion we append a bounded
// `cmd_runner tail <run_id> -n N` snapshot so the jobdone block surfaced to the
// agent (`Background jobs since your last turn:`) already carries the session
// result — no manual log spelunking (exit_code.txt / stdout.log reading).
//
// Failure-tolerant by design: any tail error is debug-logged and skipped.

import { execFile } from "node:child_process"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "cmd-runner-tail" })

/** Last N lines appended to a finished cmd_runner job. */
export const CMD_RUNNER_TAIL_LINES = 60
/** Hard timeout for the tail subprocess (cmd_runner waits on nothing here). */
export const CMD_RUNNER_TAIL_TIMEOUT_MS = 20_000

/**
 * Extract the cmd_runner run_id from job output. Only trusts cmd_runner's own
 * `inbox=…` marker (printed by `cmd_runner start`) so arbitrary command output
 * can never spoof a run id. Run ids are cmd_runner-generated session stamps.
 */
export function cmdRunnerRunID(output: string): string | undefined {
  const m = output.match(/inbox=(\S*cmd_runner[\\/](\S+?)[\\/]inbox\.jsonl)/)
  const id = m?.[2]
  // Run ids look like 20260907T094642Z_48c3b560 — reject path traversal early.
  return id && /^[A-Za-z0-9._-]+$/.test(id) ? id : undefined
}

/**
 * True when cmd_runner already streamed the session to completion inside the
 * job output (e.g. `--wait-ms 0` style flows) — tailing would only duplicate.
 */
export function cmdRunnerSessionFinished(output: string): boolean {
  return /\[session \S+: (finished|failed|killed|stopped)/.test(output)
}

async function tailSession(runID: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile(
      "cmd_runner",
      ["tail", runID, "-n", String(CMD_RUNNER_TAIL_LINES)],
      { timeout: CMD_RUNNER_TAIL_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) {
          log.debug("cmd_runner tail failed", { runID, error: String(err) })
          resolve(undefined)
          return
        }
        const text = String(stdout ?? "").trim()
        resolve(text.length > 0 ? text : undefined)
      },
    )
    child.on("error", (e) => {
      log.debug("cmd_runner tail spawn failed", { runID, error: String(e) })
      resolve(undefined)
    })
  })
}

/**
 * Build the auto-tail block for a finished cmd_runner background job.
 * Returns "" when the job is not a cmd_runner session, the session already
 * finished in-band, or the tail could not be read.
 */
export async function cmdRunnerTailBlock(output: string): Promise<string> {
  const runID = cmdRunnerRunID(output)
  if (!runID) return ""
  if (cmdRunnerSessionFinished(output)) return ""
  const tail = await tailSession(runID)
  if (!tail) return ""
  return `\n--- cmd_runner session tail (${runID}) ---\n${tail}`
}
