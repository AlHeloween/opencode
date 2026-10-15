/**
 * promote-bin.test.ts — the fixture oracle for scripts/promote_bin.py (plans/2026-10-15_safe-bin-promotion.md).
 *
 * Every scenario runs the REAL tool against a FIXTURE layout (a temp bin/ + dist/ pair whose "binary" is a
 * copy of python.exe, and a dummy opencode server implementing the same HTTP contract — health nonce echo,
 * /session/status from a control file, /session/<id>/prompt_async recorded to prompts.jsonl, a real
 * server_host row). The real D:\zPython\opencode\bin is NEVER touched here.
 *
 * Scenarios (plan Smoke Tests S1–S8):
 *   full promotion: drain waits busy->idle, swap verifies sha, resume posts to exactly the recorded sessions
 *   drain deadline stops with no change · rollback restores on a failing smoke · trial (dist/bin) process
 *   untouched · inside-session refusal · dry-run changes nothing.
 */
import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import crypto from "node:crypto"

setDefaultTimeout(90_000)

const ROOT = path.resolve(import.meta.dir, "../../..")
const TOOL = path.join(ROOT, "scripts", "promote_bin.py")
const DUMMY = path.join(ROOT, "scripts", "promote_bin_fixture_server.py")

const pythonExe = (): string => {
  const probe = spawnSync("python", ["-c", "import sys; print(sys.executable)"], { encoding: "utf-8" })
  if (probe.status !== 0) throw new Error(`python not usable: ${probe.stderr}`)
  return probe.stdout.trim()
}
const PYTHON_SRC = pythonExe()

const sha = (file: string): string =>
  crypto.createHash("sha256").update(readFileSync(file)).digest("hex")

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
  })

const pidAlive = (pid: number | undefined): boolean => {
  if (!pid) return false
  const probe = spawnSync("powershell", [
    "-NoProfile", "-Command", `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'dead' }`,
  ], { encoding: "utf-8" })
  return probe.stdout.trim() === "alive"
}

const killTree = (pid: number | undefined): void => {
  if (pid) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
}

const health = async (port: number, timeoutMs = 3000): Promise<any> => {
  const response = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(timeoutMs) })
  return response.json()
}

const waitHealth = async (port: number, timeoutMs = 30_000): Promise<any> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const body = await health(port, 1500)
      if (body?.healthy) return body
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no health on :${port} within ${timeoutMs}ms`)
}

interface Server {
  child: ChildProcess
  port: number
  state: string
}

const startServer = async (fixture: string, name: string, exe: string, port?: number): Promise<Server> => {
  const state = path.join(fixture, "state", name)
  const worktree = path.join(fixture, `worktree-${name}`)
  mkdirSync(state, { recursive: true })
  mkdirSync(worktree, { recursive: true })
  const resolved = port ?? (await freePort())
  const child = spawn(exe, [
    DUMMY, "--port", String(resolved), "--worktree", worktree, "--state", state,
    "--version-file", path.join(fixture, "state", "version.txt"),
  ], { stdio: ["ignore", "pipe", "pipe"] })
  child.stdout?.on("data", () => {})
  child.stderr?.on("data", (d) => process.stderr.write(`[dummy:${name}] ${d}`))
  await waitHealth(resolved, 20_000)
  return { child, port: resolved, state }
}

const makeFixture = (name: string): string => {
  const fixture = path.join(ROOT, ".temp", "test", "promote-bin", `${name}-${Date.now()}`)
  for (const dir of ["bin", "candidate", "dist/bin", "state", "worktree-a", "worktree-trial"]) {
    mkdirSync(path.join(fixture, dir), { recursive: true })
  }
  copyFileSync(PYTHON_SRC, path.join(fixture, "bin", "opencode.exe"))
  copyFileSync(PYTHON_SRC, path.join(fixture, "candidate", "opencode.exe"))
  copyFileSync(PYTHON_SRC, path.join(fixture, "dist", "bin", "opencode.exe"))
  writeFileSync(path.join(fixture, "state", "version.txt"), "9.9.9")
  return fixture
}

const setStatus = (fixture: string, server: string, statuses: Record<string, string>): void => {
  writeFileSync(path.join(fixture, "state", server, "status.json"), JSON.stringify(statuses))
}

const prompts = async (server: Server): Promise<string[]> => {
  const file = path.join(server.state, "prompts.jsonl")
  if (!existsSync(file)) return []
  const lines = (await fs.readFile(file, "utf-8")).split("\n").filter((line) => line.trim())
  return lines.map((line) => JSON.parse(line).session)
}

interface ToolRun {
  exited: Promise<number>
  stdout: () => string
  stderr: () => string
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>
  child: ChildProcess
}

const runTool = (fixture: string, args: string[]): ToolRun => {
  const child = spawn("python", [
    TOOL, "--fixture-dir", fixture, "--launch-mode", "hidden", ...args,
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (d) => { stdout += String(d) })
  child.stderr?.on("data", (d) => { stderr += String(d) })
  const exited = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? -1)))
  const waitFor = (pattern: RegExp, timeoutMs = 45_000) =>
    new Promise<void>((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (pattern.test(stdout)) { clearInterval(timer); resolve(); return }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer)
          reject(new Error(`timeout waiting for ${pattern}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        }
      }, 200)
    })
  return { child, exited, stdout: () => stdout, stderr: () => stderr, waitFor }
}

const servers: Server[] = []
const fixtures: string[] = []

afterAll(() => {
  for (const server of servers) killTree(server.child.pid)
  // the tool's own relaunches are processes the test did not spawn — kill anything executing from a fixture
  for (const fixture of fixtures) killFixtureProcesses(fixture)
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true })
})

const killFixtureProcesses = (fixture: string): void => {
  const probe = spawnSync("powershell", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${fixture}*' } | Select-Object -ExpandProperty ProcessId`,
  ], { encoding: "utf-8" })
  for (const line of (probe.stdout || "").split(/\r?\n/)) {
    const pid = parseInt(line.trim(), 10)
    if (Number.isFinite(pid) && pid > 0) killTree(pid)
  }
}

test("S1+S3+S5 full promotion: drain waits busy->idle, swap verifies sha, resume posts to exactly the recorded sessions", async () => {
  const fixture = makeFixture("full")
  fixtures.push(fixture)
  const binSha = sha(path.join(fixture, "bin", "opencode.exe"))
  const server = await startServer(fixture, "a", path.join(fixture, "bin", "opencode.exe"))
  servers.push(server)
  setStatus(fixture, "a", { ses_a: "busy", ses_b: "busy", ses_c: "busy" })

  const tool = runTool(fixture, ["--deadline", "30", "--poll", "1", "--exclude-session", "ses_c"])
  // ses_c is the excluded calling session: the drain counts only ses_a + ses_b and proceeds without it.
  await tool.waitFor(/drain: 2 busy/)
  setStatus(fixture, "a", {})
  const code = await tool.exited

  expect(code).toBe(0)
  expect(sha(path.join(fixture, "bin", "opencode.exe"))).toBe(sha(path.join(fixture, "candidate", "opencode.exe")))
  expect(tool.stdout()).toMatch(/drain: 2 busy/)
  expect(tool.stdout()).toMatch(/report:/)
  // resume: both drained sessions AND the excluded calling session, nobody else
  expect((await prompts(server)).sort()).toEqual(["ses_a", "ses_b", "ses_c"])
  // the maintenance marker is gone after a completed run
  expect(existsSync(path.join(fixture, "maintenance"))).toBe(false)
  // the server came back healthy after the swap
  const after = await waitHealth(server.port, 30_000)
  expect(after.version).toBe("9.9.9")
  expect(binSha.length).toBe(64)
})

test("S2 drain deadline stops with no change", async () => {
  const fixture = makeFixture("deadline")
  fixtures.push(fixture)
  const binSha = sha(path.join(fixture, "bin", "opencode.exe"))
  const server = await startServer(fixture, "a", path.join(fixture, "bin", "opencode.exe"))
  servers.push(server)
  setStatus(fixture, "a", { ses_a: "busy" })

  const tool = runTool(fixture, ["--deadline", "3", "--poll", "1"])
  const code = await tool.exited

  expect(code).toBe(4)
  expect(tool.stdout()).toMatch(/STILL BUSY at deadline/)
  expect(sha(path.join(fixture, "bin", "opencode.exe"))).toBe(binSha)
  expect(pidAlive(server.child.pid)).toBe(true)
  expect(existsSync(path.join(fixture, "maintenance"))).toBe(false)
})

test("S4 rollback restores the old binary on a failing smoke", async () => {
  const fixture = makeFixture("rollback")
  fixtures.push(fixture)
  const binSha = sha(path.join(fixture, "bin", "opencode.exe"))
  const server = await startServer(fixture, "a", path.join(fixture, "bin", "opencode.exe"))
  servers.push(server)
  setStatus(fixture, "a", {})
  // a candidate that cannot execute: the version smoke fails, the tool rolls back
  writeFileSync(path.join(fixture, "candidate", "opencode.exe"), "this is not an executable")

  const tool = runTool(fixture, ["--deadline", "10", "--poll", "1"])
  const code = await tool.exited

  expect(code).toBe(6)
  expect(tool.stderr()).toMatch(/rolled back/)
  expect(sha(path.join(fixture, "bin", "opencode.exe"))).toBe(binSha)
  // the OLD binary is back and a server is healthy again
  await waitHealth(server.port, 30_000)
  expect(await prompts(server)).toEqual([])
})

test("S6 a dist/bin trial process is listed, never drained, never relaunched", async () => {
  const fixture = makeFixture("trial")
  fixtures.push(fixture)
  const server = await startServer(fixture, "a", path.join(fixture, "bin", "opencode.exe"))
  servers.push(server)
  const trial = await startServer(fixture, "trial", path.join(fixture, "dist", "bin", "opencode.exe"))
  servers.push(trial)
  setStatus(fixture, "a", { ses_a: "busy" })
  setStatus(fixture, "trial", { ses_t: "busy" })

  const tool = runTool(fixture, ["--deadline", "30", "--poll", "1"])
  await tool.waitFor(/drain: 1 busy/)
  setStatus(fixture, "a", {})
  const code = await tool.exited

  expect(code).toBe(0)
  expect(tool.stdout()).toMatch(/TRIAL pid=/)
  // the trial process was never stopped and never resumed
  expect(pidAlive(trial.child.pid)).toBe(true)
  expect(await prompts(trial)).toEqual([])
  expect((await prompts(server)).sort()).toEqual(["ses_a"])
})

test("S7 refuses to run from inside a session served by a promoted host", async () => {
  const fixture = makeFixture("inside")
  fixtures.push(fixture)
  const binSha = sha(path.join(fixture, "bin", "opencode.exe"))
  const server = await startServer(fixture, "a", path.join(fixture, "bin", "opencode.exe"))
  servers.push(server)
  setStatus(fixture, "a", {})

  // the dummy server spawns the tool as its own child — the parent chain hits a promoted host
  writeFileSync(path.join(server.state, "spawn-tool.json"), JSON.stringify({
    args: [TOOL, "--fixture-dir", fixture, "--launch-mode", "hidden", "--deadline", "5", "--poll", "1"],
  }))
  const resultFile = path.join(server.state, "spawn-tool-result.txt")
  const deadline = Date.now() + 60_000
  while (!existsSync(resultFile) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
  }
  expect(existsSync(resultFile)).toBe(true)
  expect(readFileSync(resultFile, "utf-8").trim()).toBe("8")
  expect(readFileSync(path.join(server.state, "spawn-tool-stderr.txt"), "utf-8")).toMatch(/inside a session/)
  expect(sha(path.join(fixture, "bin", "opencode.exe"))).toBe(binSha)
  expect(pidAlive(server.child.pid)).toBe(true)
})

test("S8 dry-run prints the inventory and changes nothing", async () => {
  const fixture = makeFixture("dryrun")
  fixtures.push(fixture)
  const binSha = sha(path.join(fixture, "bin", "opencode.exe"))
  const server = await startServer(fixture, "a", path.join(fixture, "bin", "opencode.exe"))
  servers.push(server)
  setStatus(fixture, "a", { ses_a: "busy" })

  const tool = runTool(fixture, ["--dry-run"])
  const code = await tool.exited

  expect(code).toBe(0)
  expect(tool.stdout()).toMatch(/dry-run: read-only inventory printed/)
  expect(tool.stdout()).toMatch(/host pid=/)
  expect(sha(path.join(fixture, "bin", "opencode.exe"))).toBe(binSha)
  expect(pidAlive(server.child.pid)).toBe(true)
  expect(existsSync(path.join(fixture, "maintenance"))).toBe(false)
})
