/**
 * promote-bin-cold.test.ts — t60 cold-case oracle for scripts/promote_bin.py
 * (plans/2026-10-15_promote-cold-start.md).
 *
 * Cold fixture: bin/opencode.exe + candidate/opencode.exe (copies of python.exe),
 * NO servers started — no server_host rows, no process executing the fixture bin.
 * The real D:\zPython\opencode\bin is NEVER touched (--fixture-dir).
 *
 * RED today: exit 2 «no live host … — nothing to promote».
 * GREEN after: exit 0, sha(bin) == sha(candidate), .prev holds the old bytes,
 * stdout names the cold path + nothing relaunched, no maintenance marker created.
 */
import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

setDefaultTimeout(90_000)

const ROOT = path.resolve(import.meta.dir, "../../..")
const TOOL = path.join(ROOT, "scripts", "promote_bin.py")

const pythonExe = (): string => {
  const probe = spawnSync("python", ["-c", "import sys; print(sys.executable)"], { encoding: "utf-8" })
  if (probe.status !== 0) throw new Error(`python not usable: ${probe.stderr}`)
  return probe.stdout.trim()
}
const PYTHON_SRC = pythonExe()

const sha = (file: string): string =>
  crypto.createHash("sha256").update(readFileSync(file)).digest("hex")

const makeColdFixture = (name: string): string => {
  const fixture = path.join(ROOT, ".temp", "test", "promote-bin", `${name}-${Date.now()}`)
  for (const dir of ["bin", "candidate", "state"]) {
    mkdirSync(path.join(fixture, dir), { recursive: true })
  }
  copyFileSync(PYTHON_SRC, path.join(fixture, "bin", "opencode.exe"))
  copyFileSync(PYTHON_SRC, path.join(fixture, "candidate", "opencode.exe"))
  return fixture
}

interface ToolResult {
  code: number
  stdout: string
  stderr: string
}

const runToolSync = (fixture: string, args: string[]): ToolResult => {
  const result = spawnSync("python", [
    TOOL, "--fixture-dir", fixture, "--launch-mode", "hidden", ...args,
  ], { cwd: ROOT, encoding: "utf-8", timeout: 120_000 })
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

const fixtures: string[] = []

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true })
})

test("t60 cold promotion with no host swaps without relaunch", () => {
  const fixture = makeColdFixture("cold")
  fixtures.push(fixture)
  const binFile = path.join(fixture, "bin", "opencode.exe")
  const candidateFile = path.join(fixture, "candidate", "opencode.exe")
  const prevFile = path.join(fixture, "bin", "opencode.exe.prev")
  const markerFile = path.join(fixture, "maintenance")
  const oldSha = sha(binFile)

  const result = runToolSync(fixture, ["--deadline", "5", "--poll", "1"])

  expect(result.code).toBe(0)
  expect(sha(binFile)).toBe(sha(candidateFile))
  expect(existsSync(prevFile)).toBe(true)
  expect(sha(prevFile)).toBe(oldSha)
  expect(result.stdout).toMatch(/cold promotion/)
  expect(result.stdout).toMatch(/nothing.*relaunched/i)
  expect(existsSync(markerFile)).toBe(false)
})
