import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "fs"
import path from "path"
import os from "os"

function findFossil(): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "external", "fossil", "fossil.exe"),
    path.join(process.cwd(), "..", "external", "fossil", "fossil.exe"),
  ]
  for (const c of candidates) {
    const resolved = path.resolve(c)
    if (existsSync(resolved)) return resolved
  }
  throw new Error("fossil not found")
}

const FOSSIL = findFossil()
const TMP = path.join(os.tmpdir(), `fossil_lifecycle_${Date.now()}`)

function fossil(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: cwd ?? TMP, encoding: "utf-8", timeout: 10000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

// Simulate the ensureInit logic from fossil.ts
function ensureInit(repoPath: string, worktree: string): boolean {
  const fs = require("fs")

  // 1. Ensure ignore-glob
  const settingsDir = path.join(worktree, ".fossil-settings")
  const ignorePath = path.join(settingsDir, "ignore-glob")
  if (!fs.existsSync(ignorePath)) {
    fs.mkdirSync(settingsDir, { recursive: true })
    fs.writeFileSync(ignorePath, "*.fsl\n.jj\n.git\nnode_modules\n.opencode\n")
  }

  // 2. Check if repo exists
  if (!fs.existsSync(repoPath)) {
    const r = fossil(["init", repoPath], worktree)
    if (r.code !== 0) return false
  }

  // 3. Open repo (--keep preserves local files)
  const openR = fossil(["open", repoPath, "--keep"], worktree)
  // Already open is OK (code 1 with specific error)

  // 4. Initial commit if needed
  fossil(["commit", "-m", "opencode-init", "--no-warnings"], worktree)
  // "nothing to commit" is OK

  return true
}

describe("Fossil Init Lifecycle", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  })

  test("fresh init creates repo and ignore-glob", () => {
    const repoPath = path.join(TMP, "snapshot.fsl")
    const result = ensureInit(repoPath, TMP)

    expect(result).toBe(true)
    expect(existsSync(repoPath)).toBe(true)
    expect(existsSync(path.join(TMP, ".fossil-settings", "ignore-glob"))).toBe(true)
  })

  test("re-init after repo deletion", () => {
    const repoPath = path.join(TMP, "snapshot.fsl")

    // First init
    ensureInit(repoPath, TMP)
    writeFileSync(path.join(TMP, "test.txt"), "data")
    fossil(["add", "test.txt"])
    fossil(["commit", "-m", "first", "--no-warnings"])

    // Delete repo
    rmSync(repoPath)
    expect(existsSync(repoPath)).toBe(false)

    // Re-init
    const result = ensureInit(repoPath, TMP)
    expect(result).toBe(true)
    expect(existsSync(repoPath)).toBe(true)
  })

  test("ignore-glob set before first commit", () => {
    const repoPath = path.join(TMP, "snapshot.fsl")

    // Create files that should be ignored
    mkdirSync(path.join(TMP, "node_modules", "pkg"), { recursive: true })
    writeFileSync(path.join(TMP, "node_modules", "pkg", "index.js"), "module")
    writeFileSync(path.join(TMP, "app.txt"), "app")

    // Init
    ensureInit(repoPath, TMP)

    // Add and commit
    fossil(["add", "."])
    fossil(["commit", "-m", "test", "--no-warnings"])

    // Verify node_modules not tracked
    const ls = fossil(["ls"])
    expect(ls.stdout).toContain("app.txt")
    expect(ls.stdout).not.toContain("node_modules")
  })

  test("init with non-empty directory (existing files)", () => {
    const repoPath = path.join(TMP, "snapshot.fsl")

    // Create files first
    writeFileSync(path.join(TMP, "existing.txt"), "exists")
    writeFileSync(path.join(TMP, "another.txt"), "another")

    // Init should succeed (--keep preserves files)
    const result = ensureInit(repoPath, TMP)
    expect(result).toBe(true)
    expect(existsSync(repoPath)).toBe(true)
  })

  test("multiple init calls are idempotent", () => {
    const repoPath = path.join(TMP, "snapshot.fsl")

    ensureInit(repoPath, TMP)
    writeFileSync(path.join(TMP, "a.txt"), "a")
    fossil(["add", "a.txt"])
    fossil(["commit", "-m", "v1", "--no-warnings"])

    // Second init should not break anything
    ensureInit(repoPath, TMP)

    // Verify state preserved
    const ls = fossil(["ls"])
    expect(ls.stdout).toContain("a.txt")
  })

  test("init creates .fossil-settings directory", () => {
    const repoPath = path.join(TMP, "snapshot.fsl")
    ensureInit(repoPath, TMP)

    expect(existsSync(path.join(TMP, ".fossil-settings"))).toBe(true)
    expect(existsSync(path.join(TMP, ".fossil-settings", "ignore-glob"))).toBe(true)

    const content = readFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "utf-8")
    expect(content).toContain("*.fsl")
    expect(content).toContain("node_modules")
  })
})
