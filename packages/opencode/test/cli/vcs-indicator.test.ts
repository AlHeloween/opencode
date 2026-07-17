import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { detectIndicatorBackend, hasFossilSnapshot, indicatorColor } from "../../src/cli/cmd/tui/util/vcs-indicator"

function scratch(name: string) {
  const dir = join(tmpdir(), `opencode-vcs-ind-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("vcs-indicator", () => {
  test("git-only worktree shows git (red path)", () => {
    const dir = scratch("git-only")
    try {
      mkdirSync(join(dir, ".git"), { recursive: true })
      // Stuck index.lock must not change detection — we only check markers/sidecar
      writeFileSync(join(dir, ".git", "index.lock"), "")
      expect(hasFossilSnapshot(dir)).toBe(false)
      expect(detectIndicatorBackend(dir)).toBe("git")
      expect(indicatorColor("git")).toBe("#bf616a")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fossil sidecar preferred over git even with index.lock", () => {
    const dir = scratch("fossil-sidecar")
    try {
      mkdirSync(join(dir, ".git"), { recursive: true })
      writeFileSync(join(dir, ".git", "index.lock"), "stuck")
      const fossilDir = join(dir, ".opencode", "data", "fossil", "proj1")
      mkdirSync(fossilDir, { recursive: true })
      writeFileSync(join(fossilDir, "snapshot.fsl"), "fake")
      expect(hasFossilSnapshot(dir)).toBe(true)
      // Snapshot system wins for footer — independent of git health
      expect(detectIndicatorBackend(dir)).toBe("fossil")
      expect(indicatorColor("fossil")).toBe("#a3be8c")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("open markers count as fossil without sidecar file", () => {
    const dir = scratch("marker")
    try {
      mkdirSync(join(dir, ".git"), { recursive: true })
      writeFileSync(join(dir, "_FOSSIL_"), "")
      expect(detectIndicatorBackend(dir)).toBe("fossil")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("jj beats fossil and git", () => {
    const dir = scratch("jj")
    try {
      mkdirSync(join(dir, ".jj"), { recursive: true })
      mkdirSync(join(dir, ".git"), { recursive: true })
      writeFileSync(join(dir, "_fossil"), "")
      expect(detectIndicatorBackend(dir)).toBe("jj")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("empty worktree is null", () => {
    const dir = scratch("empty")
    try {
      expect(detectIndicatorBackend(dir)).toBe(null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
