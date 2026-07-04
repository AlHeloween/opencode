import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs"
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
const TMP = path.join(os.tmpdir(), `fossil_track_${Date.now()}`)

function fossil(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: TMP, encoding: "utf-8", timeout: 10000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

function initRepo() {
  const repoPath = path.join(TMP, "snapshot.fsl")
  mkdirSync(path.join(TMP, ".fossil-settings"), { recursive: true })
  writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "*.fsl\n.jj\n.git\n")
  fossil(["init", repoPath])
  fossil(["open", repoPath, "--keep"])
}

function getCurrentHash(): string {
  const r = fossil(["info", "current"])
  const match = r.stdout.match(/hash:\s+([a-f0-9]+)/)
  return match?.[1] ?? ""
}

function track(files?: string[]): string | undefined {
  // Add new files if provided
  if (files?.length) {
    for (const file of files) {
      const rel = path.relative(TMP, file).replaceAll("\\", "/")
      fossil(["add", rel])
    }
  }

  const before = getCurrentHash()

  // Commit
  const commitResult = fossil(["commit", "-m", "auto-snapshot", "--no-warnings"])
  if (commitResult.code !== 0) {
    return before // Nothing to commit
  }

  const afterHash = commitResult.stdout.match(/New_Version:\s+([a-f0-9]+)/)?.[1]?.trim()
  return afterHash ?? before
}

describe("Fossil Track & Snapshot", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    initRepo()
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  })

  test("track with new file returns commit hash", () => {
    writeFileSync(path.join(TMP, "new.txt"), "content")
    const hash = track([path.join(TMP, "new.txt")])

    expect(hash).toBeDefined()
    expect(hash!.length).toBeGreaterThanOrEqual(40)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })

  test("track with no changes returns current hash", () => {
    // Initial commit
    writeFileSync(path.join(TMP, "init.txt"), "init")
    track([path.join(TMP, "init.txt")])

    // Track with no changes
    const hash = track()
    expect(hash).toBeDefined()
    expect(hash!.length).toBeGreaterThanOrEqual(40)
  })

  test("track with modified file returns new hash", () => {
    writeFileSync(path.join(TMP, "file.txt"), "v1")
    const hash1 = track([path.join(TMP, "file.txt")])

    writeFileSync(path.join(TMP, "file.txt"), "v2")
    const hash2 = track()

    expect(hash1).not.toBe(hash2)
  })

  test("track hash is usable for restore", () => {
    writeFileSync(path.join(TMP, "data.txt"), "original")
    const hash1 = track([path.join(TMP, "data.txt")])

    writeFileSync(path.join(TMP, "data.txt"), "modified")
    track()

    // Restore to hash1
    fossil(["checkout", hash1!])
    expect(readFileSync(path.join(TMP, "data.txt"), "utf-8")).toBe("original")
  })

  test("track multiple files in one snapshot", () => {
    writeFileSync(path.join(TMP, "a.txt"), "a")
    writeFileSync(path.join(TMP, "b.txt"), "b")
    writeFileSync(path.join(TMP, "c.txt"), "c")

    const hash = track([
      path.join(TMP, "a.txt"),
      path.join(TMP, "b.txt"),
      path.join(TMP, "c.txt"),
    ])

    expect(hash).toBeDefined()

    // Verify all files tracked
    const ls = fossil(["ls"])
    expect(ls.stdout).toContain("a.txt")
    expect(ls.stdout).toContain("b.txt")
    expect(ls.stdout).toContain("c.txt")
  })

  test("track ignores gitignored files", () => {
    mkdirSync(path.join(TMP, ".fossil-settings"), { recursive: true })
    writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "*.log\nnode_modules\n")

    writeFileSync(path.join(TMP, "code.txt"), "code")
    writeFileSync(path.join(TMP, "debug.log"), "log")
    mkdirSync(path.join(TMP, "node_modules"), { recursive: true })
    writeFileSync(path.join(TMP, "node_modules", "pkg.js"), "module")

    fossil(["add", "."])
    fossil(["commit", "-m", "test", "--no-warnings"])

    const ls = fossil(["ls"])
    expect(ls.stdout).toContain("code.txt")
    expect(ls.stdout).not.toContain("debug.log")
    expect(ls.stdout).not.toContain("node_modules")
  })

  test("sequential tracks create version history", () => {
    writeFileSync(path.join(TMP, "v.txt"), "v1")
    const h1 = track([path.join(TMP, "v.txt")])

    writeFileSync(path.join(TMP, "v.txt"), "v2")
    const h2 = track()

    writeFileSync(path.join(TMP, "v.txt"), "v3")
    const h3 = track()

    expect(h1).not.toBe(h2)
    expect(h2).not.toBe(h3)

    // Timeline should show all versions
    const timeline = fossil(["timeline"])
    expect(timeline.stdout).toContain("auto-snapshot")
  })
})
