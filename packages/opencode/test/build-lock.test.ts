/**
 * build-lock.test.ts — the fixture oracle for t58 (plans/2026-10-15_build-lock.md).
 *
 * Drives the REAL lock helper (scripts/build-lock.ps1) against a FIXTURE dir via
 * $env:BUILD_LOCK_DIR / $env:BUILD_MAINTENANCE_MARKER. The real
 * .opencode/data/build/build.lock and the real t55 maintenance marker are NEVER touched here.
 *
 * Scenarios (plan Smoke Tests S1/S4):
 *   T1 two concurrent holders serialize — the rival refuses naming the first (exit 3)
 *   T2 stale lock (dead pid) is taken over, takeover printed (exit 0)
 *   T3 lock released after a failing holder (exit != 0, lock file gone)
 *   T4 maintenance marker blocks (exit 4) unless -ForceBuild (exit 0, OVERRIDE printed)
 */
import { expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

setDefaultTimeout(60_000)

const ROOT = path.resolve(import.meta.dir, "../../..")
const HELPER = path.join(ROOT, "scripts", "build-lock.ps1")

interface Attempt {
  code: number
  stdout: string
  stderr: string
}

const makeFixture = (name: string): { fixture: string; env: Record<string, string> } => {
  const fixture = path.join(ROOT, ".temp", "test", "build-lock", `${name}-${Date.now()}`)
  mkdirSync(fixture, { recursive: true })
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BUILD_LOCK_DIR: fixture,
    BUILD_MAINTENANCE_MARKER: path.join(fixture, "maintenance"),
  }
  return { fixture, env }
}

const cleanup = (fixture: string): void => {
  rmSync(fixture, { recursive: true, force: true })
}

/** Run the helper once, synchronously. */
const attempt = (env: Record<string, string>, args: string[]): Attempt => {
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

test("T1 two concurrent holders serialize: the rival refuses naming the first", async () => {
  const { fixture, env } = makeFixture("duel")
  try {
    // Holder: acquires and holds the lock for 12 s. Bun.spawn (async) — the rival runs while it holds.
    const holder = Bun.spawn(["pwsh", "-NoProfile", "-File", HELPER, "-Acquire", "-HoldSeconds", "12"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      // Wait for the holder's lock FILE (up to 20 s). Stdout text is NOT the gate:
      // console output through a pipe may sit buffered until the holder exits, while the
      // lock file is the artifact itself. The holder pid is read back from it.
      const lockFile = path.join(fixture, "build.lock")
      const deadline = Date.now() + 20_000
      let holderPid = 0
      while (Date.now() < deadline && holderPid <= 0) {
        try {
          const held = JSON.parse(readFileSync(lockFile, "utf-8"))
          if (held && Number.isFinite(Number(held.pid))) holderPid = Number(held.pid)
        } catch { /* not written yet */ }
        if (holderPid <= 0) await new Promise((r) => setTimeout(r, 200))
      }
      expect(holderPid).toBeGreaterThan(0)
      // Rival while the holder is live: must refuse at once, naming the holder.
      const rival = attempt(env, ["-Acquire"])
      expect(rival.code).toBe(3)
      expect(rival.stdout).toMatch(/another build holds the lock/)
      expect(rival.stdout).toMatch(new RegExp(`pid=${holderPid}`))
    } finally {
      await holder.exited
    }
    expect(holder.exitCode).toBe(0)
    // Released on the holder's normal exit.
    expect(existsSync(path.join(fixture, "build.lock"))).toBe(false)
  } finally {
    cleanup(fixture)
  }
})

test("T2 stale lock (dead pid) is taken over, takeover printed", () => {
  const { fixture, env } = makeFixture("stale")
  try {
    writeFileSync(
      path.join(fixture, "build.lock"),
      JSON.stringify({ pid: 2147483647, started: "2026-10-15T00:00:00Z", caller: "dead-robot" }),
    )
    const run = attempt(env, ["-Acquire", "-HoldSeconds", "0"])
    expect(run.code).toBe(0)
    expect(run.stdout).toMatch(/STALE.*taking over/)
    expect(existsSync(path.join(fixture, "build.lock"))).toBe(false)
  } finally {
    cleanup(fixture)
  }
})

test("T3 lock released after a failing holder", () => {
  const { fixture, env } = makeFixture("fail")
  try {
    const run = attempt(env, ["-Acquire", "-FailAfterAcquire"])
    expect(run.code).not.toBe(0)
    expect(existsSync(path.join(fixture, "build.lock"))).toBe(false)
  } finally {
    cleanup(fixture)
  }
})

test("T4 maintenance marker blocks unless -ForceBuild", () => {
  const { fixture, env } = makeFixture("marker")
  try {
    writeFileSync(path.join(fixture, "maintenance"), JSON.stringify({ since: 1, reason: "test" }))
    const blocked = attempt(env, ["-Acquire"])
    expect(blocked.code).toBe(4)
    expect(blocked.stdout).toMatch(/maintenance/)
    expect(existsSync(path.join(fixture, "build.lock"))).toBe(false)

    const forced = attempt(env, ["-Acquire", "-ForceBuild", "-HoldSeconds", "0"])
    expect(forced.code).toBe(0)
    expect(forced.stdout).toMatch(/OVERRIDE/)
  } finally {
    cleanup(fixture)
  }
})
