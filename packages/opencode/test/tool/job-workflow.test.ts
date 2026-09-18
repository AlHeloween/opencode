/**
 * End-to-end tests for the full background job workflow:
 *   bash (background) → job_output → job_wait → stalled detection → job_kill / job_reset
 *
 * Validates:
 *   - Commands run non-blocking by default
 *   - job_output returns incremental output + status WHILE the job runs (streaming)
 *   - job_wait polls until terminal state
 *   - Stalled detection fires after 15s no output
 *   - job_reset re-arms a running job's stall deadline; no-op on terminal jobs
 *   - job_kill transitions running/stalled → killed
 *   - job_kill is a no-op on already-terminal jobs
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Config } from "@/config/config"
import { Shell } from "../../src/shell/shell"
import { BashTool } from "../../src/tool/bash"
import { JobOutputTool, JobWaitTool } from "../../src/tool/joboutput"
import { JobKillTool } from "../../src/tool/jobkill"
import { JobResetTool } from "../../src/tool/jobreset"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"
import { Jobs } from "../../src/jobs"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
    Jobs.defaultLayer,
  ),
)

async function initBash() {
  return runtime.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
}
async function initJobOutput() {
  return runtime.runPromise(JobOutputTool.pipe(Effect.flatMap((info) => info.init())))
}
async function initJobWait() {
  return runtime.runPromise(JobWaitTool.pipe(Effect.flatMap((info) => info.init())))
}
async function initJobKill() {
  return runtime.runPromise(JobKillTool.pipe(Effect.flatMap((info) => info.init())))
}
async function initJobReset() {
  return runtime.runPromise(JobResetTool.pipe(Effect.flatMap((info) => info.init())))
}

const projectRoot = path.join(__dirname, "../..")
const bin = process.execPath.replaceAll("\\", "/")

const squote = (text: string) => `'${text}'`
const quote = (text: string) => `"${text}"`
const sh = () => Shell.name(Shell.acceptable())
const evalarg = (text: string) => (sh() === "cmd" ? quote(text) : squote(text))

/** Command that prints 5 lines over ~5 seconds */
const slowCmd = () => {
  const code = `for (let i = 1; i <= 5; i++) { setTimeout(() => process.stdout.write('line ' + i + '\\n'), i * 800) }`
  const text = `${bin} -e ${evalarg(code)}`
  if (sh() === "pwsh" || sh() === "powershell") return `& ${text}`
  return text
}

/** Command that prints nothing for 30s (simulates hang) */
const silentCmd = () => {
  const code = `setTimeout(() => process.stdout.write('DONE\\n'), 30000)`
  const text = `${bin} -e ${evalarg(code)}`
  if (sh() === "pwsh" || sh() === "powershell") return `& ${text}`
  return text
}

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.job-workflow", () => {
  test("full lifecycle: bash → job_output → job_wait → done", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const jobOutput = await initJobOutput()
        const jobWait = await initJobWait()

        // 1. Start a slow command (5 lines over ~5s) — runs in background
        const started = await runtime.runPromise(
          bash.execute(
            { command: slowCmd(), description: "Slow multi-line command" },
            ctx,
          ),
        )
        const jobID = started.metadata.jobID
        expect(jobID).toBeDefined()
        expect(started.output).toContain("background job")

        // 2. Poll job_output until real command output appears. It MUST appear
        //    while the job is still running: this is the streaming invariant.
        //    Without the cmd/bash `onOutput` wiring the job output never leaves
        //    the `[started]` banner and this read never sees command output
        //    (2026-09-18 — silent long jobs used to be auto-killed because of it).
        let streamedText = ""
        let streamedStatus = ""
        const streamDeadline = Date.now() + 8000
        while (Date.now() < streamDeadline) {
          const out = await runtime.runPromise(
            jobOutput.execute({ job_id: jobID as string }, ctx),
          )
          streamedText = out.output
          streamedStatus = out.metadata.status as string
          if (/line \d/.test(streamedText) || streamedStatus !== "running") break
          await Bun.sleep(250)
        }
        expect(streamedText).toMatch(/line \d/)
        expect(streamedStatus).toBe("running")

        // 3. Wait for completion
        const waited = await runtime.runPromise(
          jobWait.execute({ job_ids: [jobID as string], timeout: 15000 }, ctx),
        )
        // After waiting, the job should be done
        const final = await runtime.runPromise(
          jobOutput.execute({ job_id: jobID as string }, ctx),
        )
        expect(final.metadata.status).toBe("done")
      },
    })
  }, { timeout: 20_000 })

  test("stalled → job_kill flow", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const jobOutput = await initJobOutput()
        const jobKill = await initJobKill()

        // 1. Start a command that produces no output for 30s
        const started = await runtime.runPromise(
          bash.execute(
            { command: silentCmd(), description: "Silent 30s command" },
            ctx,
          ),
        )
        const jobID = started.metadata.jobID
        expect(jobID).toBeDefined()

        // 2. Wait for stalled detection (15s threshold + 5s heartbeat = ~20s max)
        // We'll poll job_output until status becomes "stalled"
        let status: string = "running"
        const deadline = Date.now() + 25_000
        while (status === "running" && Date.now() < deadline) {
          const out = await runtime.runPromise(
            jobOutput.execute({ job_id: jobID as string }, ctx),
          )
          status = out.metadata.status as string
          if (status !== "stalled") await Bun.sleep(500)
        }
        expect(status).toBe("stalled")

        // 3. Kill the stalled job
        const killed = await runtime.runPromise(
          jobKill.execute({ job_id: jobID as string }, ctx),
        )
        expect(killed.metadata.killed).toBe(true)

        // 4. Verify it's killed
        const final = await runtime.runPromise(
          jobOutput.execute({ job_id: jobID as string }, ctx),
        )
        expect(final.metadata.status).toBe("killed")
      },
    })
  }, { timeout: 35_000 })

  test("job_kill no-op on already-done job", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const jobOutput = await initJobOutput()
        const jobWait = await initJobWait()
        const jobKill = await initJobKill()

        // Start a quick command and wait for it
        const started = await runtime.runPromise(
          bash.execute(
            { command: `echo quick`, description: "Quick command" },
            ctx,
          ),
        )
        const jobID = started.metadata.jobID
        await runtime.runPromise(
          jobWait.execute({ job_ids: [jobID as string], timeout: 5000 }, ctx),
        )

        // Try to kill an already-done job
        const result = await runtime.runPromise(
          jobKill.execute({ job_id: jobID as string }, ctx),
        )
        expect(result.metadata.killed).toBe(false)
        expect(result.output).toContain("not running")

        // The no-op must PRESERVE the terminal record — a done job stays done
        // (the old code rewrote it to "killed" and reported success).
        const final = await runtime.runPromise(
          jobOutput.execute({ job_id: jobID as string }, ctx),
        )
        expect(final.metadata.status).toBe("done")
      },
    })
  }, { timeout: 15_000 })

  test("job_reset re-arms a running job; no-op on a killed job", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const jobReset = await initJobReset()
        const jobKill = await initJobKill()

        // 1. Running job → reset accepted (deadline re-armed, job keeps running)
        const started = await runtime.runPromise(
          bash.execute(
            { command: silentCmd(), description: "Reset target" },
            ctx,
          ),
        )
        const jobID = started.metadata.jobID as string
        const reset = await runtime.runPromise(
          jobReset.execute({ job_id: jobID }, ctx),
        )
        expect(reset.metadata.reset).toBe(true)
        expect(reset.output).toContain("reset")

        // 2. Terminal job → no-op (reset never revives a killed job)
        const killed = await runtime.runPromise(
          jobKill.execute({ job_id: jobID }, ctx),
        )
        expect(killed.metadata.killed).toBe(true)
        const resetAgain = await runtime.runPromise(
          jobReset.execute({ job_id: jobID }, ctx),
        )
        expect(resetAgain.metadata.reset).toBe(false)
        expect(resetAgain.output).toContain("not running")
      },
    })
  }, { timeout: 20_000 })
})
