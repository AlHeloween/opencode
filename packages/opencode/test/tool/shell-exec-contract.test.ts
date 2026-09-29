/**
 * Execution contract shared by the bash and cmd tools, driven on EVERY path the product has:
 *
 *   fallback — `run_in_background` default, no Jobs service in the runtime
 *   sync     — `run_in_background: false`
 *   job      — `run_in_background` default, Jobs service present (the production default)
 *
 * The older suites (bash.test.ts / cmd.test.ts) run `execute` through a bare `Effect.runPromise`,
 * so `Effect.serviceOption(Jobs.Service)` is always None and only the fallback was ever exercised.
 * Plan: plans/2026-09-29_bash-tool-single-execution-path.md (A1 A2 A3, D1, C7, C8).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { Config } from "@/config/config"
import { Shell } from "../../src/shell/shell"
import { BashTool } from "../../src/tool/bash"
import { CmdTool } from "../../src/tool/cmd"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"
import { Jobs, setJobsDbPathForTests } from "../../src/jobs"
import { setCmdRunnerProbe } from "../../src/tool/shell-constitution"
import { stripCommand } from "../../src/tool/strip-win"

setDefaultTimeout(30_000)

const base = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
)
const plain = ManagedRuntime.make(base)
const withJobs = ManagedRuntime.make(Layer.mergeAll(base, Jobs.layer))

const sessionID = SessionID.make("ses_exec_contract")
const ctx = {
  sessionID,
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const comspec = process.env.COMSPEC || "cmd.exe"
const TOOLS = [
  { name: "bash", def: BashTool },
  { name: "cmd", def: CmdTool },
] as const
const MODES = ["fallback", "sync", "job"] as const
type Mode = (typeof MODES)[number]

// A stand-in `cmd_runner` on PATH: the wrap is observable by what it prints, with no real runner.
let runnerDir = ""
let jobsDir = ""
const prevPath = process.env.PATH
const prevShell = process.env.SHELL

beforeAll(() => {
  runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-contract-runner-"))
  fs.writeFileSync(
    path.join(runnerDir, "cmd_runner.cmd"),
    ["@echo off", 'if "%1"=="sleep" ping -n 4 127.0.0.1 >nul', "echo FAKE_RUNNER %*", ""].join("\r\n"),
  )
  jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-contract-jobs-"))
  setJobsDbPathForTests(path.join(jobsDir, "jobs.db"))
  process.env.PATH = `${runnerDir}${path.delimiter}${prevPath ?? ""}`
  // The bash tool picks its shell from SHELL; pin it to cmd so both tools speak one grammar here.
  process.env.SHELL = comspec
  Shell.acceptable.reset()
  Shell.preferred.reset()
  setCmdRunnerProbe(true)
})

afterAll(async () => {
  setCmdRunnerProbe(undefined)
  process.env.PATH = prevPath
  if (prevShell === undefined) delete process.env.SHELL
  else process.env.SHELL = prevShell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  await withJobs.dispose()
  await plain.dispose()
  setJobsDbPathForTests(undefined)
  fs.rmSync(runnerDir, { recursive: true, force: true })
  fs.rmSync(jobsDir, { recursive: true, force: true })
})

type Def = (typeof TOOLS)[number]["def"]
type Params = { command: string; description: string; timeout?: number; workdir?: string }

/** Run one call on one path and return what the MODEL would read from it. */
async function exec(def: Def, mode: Mode, params: Params) {
  const rt = mode === "job" ? withJobs : plain
  const tool = await rt.runPromise(def.pipe(Effect.flatMap((info) => info.init())))
  const result = await rt.runPromise(
    tool.execute({ ...params, run_in_background: mode !== "sync" }, ctx) as Effect.Effect<{
      output: string
      metadata: { exit?: number | null; jobID?: string }
    }>,
  )
  if (mode !== "job") return { output: result.output, exit: result.metadata.exit }

  const jobID = result.metadata.jobID
  expect(jobID).toBeTruthy()
  const id = Jobs.JobID.make(jobID!)
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const info = await withJobs.runPromise(
      Effect.gen(function* () {
        const svc = yield* Jobs.Service
        return (yield* svc.list({ sessionID })).find((j) => j.id === id)
      }),
    )
    if (info && info.status !== "running" && info.status !== "stalled") break
    await Bun.sleep(100)
  }
  const read = await withJobs.runPromise(
    Effect.gen(function* () {
      const svc = yield* Jobs.Service
      return yield* svc.output({ sessionID, jobID: id })
    }),
  )
  return { output: read.text, exit: undefined, status: read.status }
}

const inTmp = <T>(fn: (dir: string) => Promise<T>) =>
  (async () => {
    await using tmp = await tmpdir()
    return Instance.provide({ directory: tmp.path, fn: () => fn(tmp.path) })
  })()

describe.skipIf(process.platform !== "win32")("shell exec contract", () => {
  for (const tool of TOOLS) {
    for (const mode of MODES) {
      // A3 / C3: cmd.exe `/c` strips the first and last quote of a line with more than two, so the
      // payload leaves quoting and `>` becomes a redirect into the cwd.
      test(`${tool.name} [${mode}] passes a quoted command to cmd.exe intact`, () =>
        inTmp(async (dir) => {
          const before = fs.readdirSync(dir)
          const result = await exec(tool.def, mode, {
            command: `"${comspec}" /c echo "a=>b"`,
            description: "quoted payload",
          })
          expect(result.output).toContain("a=>b")
          expect(fs.readdirSync(dir)).toEqual(before)
        }))

      // A1 / C1: the cmd_runner auto-wrap must be what EXECUTES, not only what is scanned.
      test(`${tool.name} [${mode}] executes the cmd_runner-wrapped command`, () =>
        inTmp(async () => {
          const result = await exec(tool.def, mode, { command: "cargo --version", description: "wrapped" })
          expect(result.output).toContain("FAKE_RUNNER start -- cargo --version")
        }))

      // A2 / C2: path warnings reach the model on every path.
      test(`${tool.name} [${mode}] reports path issues`, () =>
        inTmp(async () => {
          const system = process.env.SystemRoot || process.env.windir
          expect(system).toBeTruthy()
          const result = await exec(tool.def, mode, { command: "echo hi", description: "warn", workdir: system })
          expect(result.output).toContain("Path issues detected")
        }))

      // D1 / C4: the timeout is enforced.
      test(`${tool.name} [${mode}] kills a command that exceeds its timeout`, () =>
        inTmp(async () => {
          const t0 = Date.now()
          const result = await exec(tool.def, mode, {
            command: "ping -n 30 127.0.0.1",
            description: "overrun",
            timeout: 1500,
          })
          expect(Date.now() - t0).toBeLessThan(20_000)
          expect(result.output).toContain("exceeding timeout")
          if (mode !== "job") expect(result.exit).toBeNull()
        }))

      // D1: cmd_runner owns its own lifecycle — the only command with no timeout.
      test(`${tool.name} [${mode}] does not time out a cmd_runner command`, () =>
        inTmp(async () => {
          const result = await exec(tool.def, mode, { command: "cmd_runner sleep", description: "runner", timeout: 1000 })
          expect(result.output).toContain("FAKE_RUNNER sleep")
          expect(result.output).not.toContain("exceeding timeout")
        }))
    }

    // C8: an AST block always says why.
    test(`${tool.name} names the reason when it blocks an enumerator`, () =>
      inTmp(async () => {
        const err = await exec(tool.def, "sync", { command: "dir", description: "enumerate" }).then(
          () => undefined,
          (e: unknown) => e,
        )
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toContain("BLOCKED")
      }))
  }
})

// C7: an fd number is a whole token, never the tail of another one.
describe("stripCommand fd redirects", () => {
  test("keeps the last digit of an address before `> nul`", () => {
    expect(stripCommand("ping -n 2 127.0.0.1 > nul", comspec).command).toBe("ping -n 2 127.0.0.1")
  })
  test("keeps a trailing 2 before `>nul`", () => {
    expect(stripCommand("echo 12 >nul", comspec).command).toBe("echo 12")
  })
  test("still strips real fd redirects", () => {
    expect(stripCommand("dir 2>nul", comspec).command).toBe("dir")
    expect(stripCommand("echo a 1>nul", comspec).command).toBe("echo a")
  })
})
