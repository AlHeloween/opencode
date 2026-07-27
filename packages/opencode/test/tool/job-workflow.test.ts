/**
 * End-to-end tests for the full background job workflow:
 *   bash (background) → job_output → job_wait → stalled detection → job_kill
 *
 * Validates:
 *   - Commands run non-blocking by default
 *   - job_output returns incremental output + status
 *   - job_wait polls until terminal state
 *   - Stalled detection fires after 15s no output
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

        // 2. Read output incrementally — should see partial lines
        await runtime.runPromise(Effect.sleep(1500)) // wait for first lines
        const out1 = await runtime.runPromise(
          jobOutput.execute({ job_id: jobID as string }, ctx),
        )
        expect(out1.metadata.status).toMatch(/running|done/)
        // Should have some output from the first 1-2 lines
        expect(out1.output.length).toBeGreaterThan(0)

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
      },
    })
  }, { timeout: 15_000 })
})
