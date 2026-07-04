import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs"
import path from "path"
import os from "os"

// Find fossil binary
function findFossil(): string {
  const candidates = [
    path.join(process.cwd(), "tools", "fossil.exe"),
    path.join(path.dirname(process.execPath), "tools", "fossil.exe"),
    path.join(process.cwd(), "..", "..", "external", "fossil", "fossil.exe"),
    path.join(process.cwd(), "..", "external", "fossil", "fossil.exe"),
  ]
  for (const c of candidates) {
    const resolved = path.resolve(c)
    if (existsSync(resolved)) return resolved
  }
  throw new Error(`fossil not found. cwd=${process.cwd()}, execPath=${process.execPath}`)
}

const FOSSIL = findFossil()
const TMP = path.join(os.tmpdir(), `fossil_test_${Date.now()}`)

function fossil(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, {
      cwd: cwd ?? TMP,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message }
  }
}

describe("Fossil Command Validation", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  })

  test("fossil init creates repo", () => {
    const repoPath = path.join(TMP, "test.fsl")
    const result = fossil(["init", repoPath])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("project-id:")
    expect(existsSync(repoPath)).toBe(true)
  })

  test("fossil open --keep opens repo in non-empty dir", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    writeFileSync(path.join(TMP, "existing.txt"), "hello")
    const result = fossil(["open", repoPath, "--keep"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("checkout:")
  })

  test("fossil add tracks new file", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "new.txt"), "content")
    const result = fossil(["add", "new.txt"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ADDED")
  })

  test("fossil commit creates version", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "file.txt"), "hello")
    fossil(["add", "file.txt"])
    const result = fossil(["commit", "-m", "test commit", "--no-warnings"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/New_Version:\s+[a-f0-9]{40}/)
  })

  test("fossil commit with no changes returns non-zero", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    // Initial commit
    writeFileSync(path.join(TMP, "init.txt"), "init")
    fossil(["add", "init.txt"])
    fossil(["commit", "-m", "init", "--no-warnings"])
    // Second commit with no changes
    const result = fossil(["commit", "-m", "empty", "--no-warnings"])
    expect(result.code).not.toBe(0)
  })

  test("fossil info current returns hash", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "a.txt"), "a")
    fossil(["add", "a.txt"])
    fossil(["commit", "-m", "snap", "--no-warnings"])
    const result = fossil(["info", "current"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/hash:\s+[a-f0-9]{40}/)
  })

  test("fossil info current hash is parseable", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "b.txt"), "b")
    fossil(["add", "b.txt"])
    fossil(["commit", "-m", "snap", "--no-warnings"])
    const result = fossil(["info", "current"])
    const match = result.stdout.match(/hash:\s+([a-f0-9]+)/)
    expect(match).not.toBeNull()
    expect(match![1].length).toBeGreaterThanOrEqual(40)
  })

  test("fossil diff --brief shows changed files", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "c.txt"), "c")
    fossil(["add", "c.txt"])
    fossil(["commit", "-m", "snap", "--no-warnings"])
    writeFileSync(path.join(TMP, "c.txt"), "modified")
    const result = fossil(["diff", "--brief"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("CHANGED")
    expect(result.stdout).toContain("c.txt")
  })

  test("fossil diff -s returns insertions/deletions", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "d.txt"), "line1\nline2\n")
    fossil(["add", "d.txt"])
    fossil(["commit", "-m", "snap", "--no-warnings"])
    writeFileSync(path.join(TMP, "d.txt"), "line1\nline2\nline3\n")
    const result = fossil(["diff", "-s"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("d.txt")
    // Parse: "  INSERTED  DELETED  file.txt"
    const lines = result.stdout.split("\n").filter((l) => l.includes("d.txt") && !l.includes("TOTAL"))
    expect(lines.length).toBeGreaterThan(0)
    const parts = lines[0].trim().split(/\s+/)
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parseInt(parts[0])).toBeGreaterThan(0)
  })

  test("fossil diff --from VERSION --brief shows files since version", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "e.txt"), "e")
    fossil(["add", "e.txt"])
    fossil(["commit", "-m", "v1", "--no-warnings"])
    // Get v1 hash
    const info1 = fossil(["info", "current"])
    const hash1 = info1.stdout.match(/hash:\s+([a-f0-9]+)/)![1]
    // Make v2
    writeFileSync(path.join(TMP, "f.txt"), "f")
    fossil(["add", "f.txt"])
    fossil(["commit", "-m", "v2", "--no-warnings"])
    // Diff from v1
    const result = fossil(["diff", "--from", hash1, "--brief"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("f.txt")
  })

  test("fossil revert -r VERSION reverts file", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "g.txt"), "original")
    fossil(["add", "g.txt"])
    fossil(["commit", "-m", "v1", "--no-warnings"])
    const info1 = fossil(["info", "current"])
    const hash1 = info1.stdout.match(/hash:\s+([a-f0-9]+)/)![1]
    // Modify and commit
    writeFileSync(path.join(TMP, "g.txt"), "modified")
    fossil(["commit", "-m", "v2", "--no-warnings"])
    // Revert to v1
    const result = fossil(["revert", "g.txt", "-r", hash1])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("REVERT")
    expect(readFileSync(path.join(TMP, "g.txt"), "utf-8")).toBe("original")
  })

  test("fossil update rolls back entire checkout", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "h.txt"), "v1")
    fossil(["add", "h.txt"])
    fossil(["commit", "-m", "v1", "--no-warnings"])
    const info1 = fossil(["info", "current"])
    const hash1 = info1.stdout.match(/hash:\s+([a-f0-9]+)/)![1]
    // v2
    writeFileSync(path.join(TMP, "h.txt"), "v2")
    writeFileSync(path.join(TMP, "i.txt"), "new file")
    fossil(["add", "i.txt"])
    fossil(["commit", "-m", "v2", "--no-warnings"])
    // Rollback to v1 — checkout forces file restoration
    const result = fossil(["checkout", hash1])
    expect(result.code).toBe(0)
    expect(readFileSync(path.join(TMP, "h.txt"), "utf-8")).toBe("v1")
  })

  test("fossil undo is available after checkout change", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "j.txt"), "original")
    fossil(["add", "j.txt"])
    fossil(["commit", "-m", "v1", "--no-warnings"])
    // Modify working copy (not committed)
    writeFileSync(path.join(TMP, "j.txt"), "changed")
    // Revert to checkout version
    const revertResult = fossil(["revert", "j.txt"])
    expect(revertResult.code).toBe(0)
    expect(readFileSync(path.join(TMP, "j.txt"), "utf-8")).toBe("original")
    // Now undo the revert
    const undoResult = fossil(["undo"])
    expect(undoResult.code).toBe(0)
    expect(readFileSync(path.join(TMP, "j.txt"), "utf-8")).toBe("changed")
  })

  test("fossil timeline shows history", () => {
    const repoPath = path.join(TMP, "test.fsl")
    fossil(["init", repoPath])
    fossil(["open", repoPath, "--keep"])
    writeFileSync(path.join(TMP, "k.txt"), "k")
    fossil(["add", "k.txt"])
    fossil(["commit", "-m", "my snapshot", "--no-warnings"])
    const result = fossil(["timeline"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("my snapshot")
  })
})
