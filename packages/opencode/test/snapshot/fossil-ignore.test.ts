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
const TMP = path.join(os.tmpdir(), `fossil_ignore_test_${Date.now()}`)

function fossil(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: TMP, encoding: "utf-8", timeout: 10000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

describe("Fossil ignore-glob integration", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    fossil(["init", path.join(TMP, "repo.fsl")])
    fossil(["open", path.join(TMP, "repo.fsl"), "--keep"])
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  })

  test("ignore-glob excludes matched files from fossil add", () => {
    // Create ignore-glob BEFORE adding files
    mkdirSync(path.join(TMP, ".fossil-settings"), { recursive: true })
    writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "*.log\nnode_modules\n")

    // Create files
    writeFileSync(path.join(TMP, "code.txt"), "code")
    writeFileSync(path.join(TMP, "debug.log"), "log data")
    mkdirSync(path.join(TMP, "node_modules"), { recursive: true })
    writeFileSync(path.join(TMP, "node_modules", "pkg.js"), "module")

    // Add all
    fossil(["add", "."])
    fossil(["commit", "-m", "test", "--no-warnings"])

    // Check what's tracked
    const status = fossil(["ls"])
    expect(status.stdout).toContain("code.txt")
    expect(status.stdout).not.toContain("debug.log")
    expect(status.stdout).not.toContain("node_modules")
  })

  test("ignore-glob with directory patterns", () => {
    mkdirSync(path.join(TMP, ".fossil-settings"), { recursive: true })
    writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "build\n.cache\n")

    mkdirSync(path.join(TMP, "build"), { recursive: true })
    writeFileSync(path.join(TMP, "build", "output.js"), "compiled")
    mkdirSync(path.join(TMP, ".cache"), { recursive: true })
    writeFileSync(path.join(TMP, ".cache", "data"), "cached")
    writeFileSync(path.join(TMP, "src.txt"), "source")

    fossil(["add", "."])
    fossil(["commit", "-m", "test", "--no-warnings"])

    const status = fossil(["ls"])
    expect(status.stdout).toContain("src.txt")
    expect(status.stdout).not.toContain("build")
    expect(status.stdout).not.toContain(".cache")
  })

  test("ignore-glob with wildcard patterns (* crosses /)", () => {
    mkdirSync(path.join(TMP, ".fossil-settings"), { recursive: true })
    writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "*.log\n*.tmp\n")

    writeFileSync(path.join(TMP, "app.log"), "log")
    writeFileSync(path.join(TMP, "data.tmp"), "tmp")
    mkdirSync(path.join(TMP, "sub"), { recursive: true })
    writeFileSync(path.join(TMP, "sub", "deep.log"), "deep log")
    writeFileSync(path.join(TMP, "sub", "keep.txt"), "keep")

    fossil(["add", "."])
    fossil(["commit", "-m", "test", "--no-warnings"])

    const status = fossil(["ls"])
    expect(status.stdout).toContain("sub/keep.txt")
    expect(status.stdout).not.toContain("app.log")
    expect(status.stdout).not.toContain("data.tmp")
    expect(status.stdout).not.toContain("deep.log") // * crosses /
  })

  test("ignore-glob is versioned (committed with repo)", () => {
    mkdirSync(path.join(TMP, ".fossil-settings"), { recursive: true })
    writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "*.log\n")

    writeFileSync(path.join(TMP, "a.txt"), "a")
    fossil(["add", ".fossil-settings/ignore-glob"])
    fossil(["add", "."])
    fossil(["commit", "-m", "with ignore", "--no-warnings"])

    // Verify ignore-glob is tracked
    const status = fossil(["ls"])
    expect(status.stdout).toContain("ignore-glob")
  })
})
