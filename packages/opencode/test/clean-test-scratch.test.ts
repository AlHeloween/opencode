/**
 * clean-test-scratch.test.ts — the fixture oracle for t74
 * (plans/2026-10-16_build-cleanup-vs-tests.md).
 *
 * Drives the REAL cleanup helper (scripts/test-scratch.ps1) against a FIXTURE
 * dir via $env:TEST_SCRATCH_DIR. The real .temp/test/ is NEVER touched here.
 *
 * Scenarios (plan S1/S4):
 *   T1 live owner pid survives the cleanup — sentinel intact (exit 0)
 *   T2 dead owner pid is removed (exit 0)
 *   T3 fresh dir without a marker survives — recent, possibly a live dir of
 *      old code without markers (exit 0)
 *   T4 old dir without a marker is removed — the 80 GB concern stays
 *      covered (exit 0)
 *   T5 opencode-test-data-<live pid> survives by name alone, no marker
 *      (preload.ts per-process dirs carry the pid in the name) (exit 0)
 *   T6 orphan marker (dir gone, e.g. crashed run) is swept, live pid or not
 *      (exit 0)
 *   T7 marker with a dead pid is swept with its dir (exit 0)
 */
import { expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { utimes } from "node:fs/promises"
import path from "node:path"

setDefaultTimeout(60_000)

const ROOT = path.resolve(import.meta.dir, "../../..")
const HELPER = path.join(ROOT, "scripts", "test-scratch.ps1")

/** A dead pid by construction — same trick as build-lock.test.ts T2. */
const DEAD_PID = 2147483647

const makeScratch = (name: string): { scratch: string; env: Record<string, string> } => {
  const scratch = path.join(ROOT, ".temp", "test", "clean-scratch", `${name}-${Date.now()}`)
  mkdirSync(scratch, { recursive: true })
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TEST_SCRATCH_DIR: scratch,
  }
  return { scratch, env }
}

const cleanup = (scratch: string): void => {
  rmSync(scratch, { recursive: true, force: true })
}

/** One live test dir inside the scratch root, with a sentinel file. The owner
 * marker is a SIBLING `<dir>.owner.json` — never inside the dir, so git porcelain
 * and exact file listings stay untouched (t74). */
const makeLiveDir = (scratch: string, name: string, ownerPid: number | null): string => {
  const dir = path.join(scratch, name)
  mkdirSync(dir, { recursive: true })
  if (ownerPid !== null) {
    writeFileSync(
      dir + ".owner.json",
      JSON.stringify({ pid: ownerPid, started: new Date().toISOString() }),
    )
  }
  writeFileSync(path.join(dir, "sentinel.txt"), "live")
  return dir
}

const makeOld = async (dir: string, minutesBack: number): Promise<void> => {
  const old = new Date(Date.now() - minutesBack * 60_000)
  await utimes(dir, old, old)
}

/** Run the helper once, synchronously. */
const attempt = (env: Record<string, string>, args: string[]): { code: number; stdout: string; stderr: string } => {
  const probe = spawnSync("pwsh", ["-NoProfile", "-File", HELPER, ...args], {
    encoding: "utf-8",
    env,
    timeout: 30_000,
  })
  return {
    code: probe.status ?? -1,
    stdout: probe.stdout ?? "",
    stderr: probe.stderr ?? "",
  }
}

test("T1 dir with a live owner pid survives the cleanup", () => {
  const { scratch, env } = makeScratch("live")
  try {
    const dir = makeLiveDir(scratch, "opencode-test-abc123", process.pid)
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(path.join(dir, "sentinel.txt"))).toBe(true)
  } finally {
    cleanup(scratch)
  }
})

test("T2 dir with a dead owner pid is removed", () => {
  const { scratch, env } = makeScratch("dead")
  try {
    const dir = makeLiveDir(scratch, "opencode-test-def456", DEAD_PID)
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(dir)).toBe(false)
  } finally {
    cleanup(scratch)
  }
})

test("T3 fresh dir without a marker survives (possibly live old code)", () => {
  const { scratch, env } = makeScratch("fresh")
  try {
    const dir = makeLiveDir(scratch, "opencode-test-fresh01", null)
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(path.join(dir, "sentinel.txt"))).toBe(true)
  } finally {
    cleanup(scratch)
  }
})

test("T4 old dir without a marker is removed (80 GB concern covered)", async () => {
  const { scratch, env } = makeScratch("old")
  try {
    const dir = makeLiveDir(scratch, "opencode-test-old0001", null)
    await makeOld(dir, 120)
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(dir)).toBe(false)
  } finally {
    cleanup(scratch)
  }
})

test("T5 opencode-test-data-<live pid> survives by name without a marker", () => {
  const { scratch, env } = makeScratch("byname")
  try {
    const dir = makeLiveDir(scratch, `opencode-test-data-${process.pid}`, null)
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(path.join(dir, "sentinel.txt"))).toBe(true)
  } finally {
    cleanup(scratch)
  }
})

test("T6 orphan marker without its dir is swept", () => {
  const { scratch, env } = makeScratch("orphan")
  try {
    const orphan = path.join(scratch, "opencode-test-gone999.owner.json")
    writeFileSync(
      orphan,
      JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
    )
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(orphan)).toBe(false)
  } finally {
    cleanup(scratch)
  }
})

test("T7 marker with a dead pid is swept with its dir", () => {
  const { scratch, env } = makeScratch("deadmarker")
  try {
    const dir = makeLiveDir(scratch, "opencode-test-deadpid", DEAD_PID)
    const run = attempt(env, ["-Clean"])
    expect(run.code).toBe(0)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(dir + ".owner.json")).toBe(false)
  } finally {
    cleanup(scratch)
  }
})
