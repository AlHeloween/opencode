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
const TMP = path.join(os.tmpdir(), `fossil_rollback_${Date.now()}`)

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
  writeFileSync(path.join(TMP, ".fossil-settings", "ignore-glob"), "*.fsl\n")
  fossil(["init", repoPath])
  fossil(["open", repoPath, "--keep"])
}

function getCurrentHash(): string {
  const r = fossil(["info", "current"])
  return r.stdout.match(/hash:\s+([a-f0-9]+)/)?.[1] ?? ""
}

function track(files?: string[]): string {
  if (files?.length) {
    for (const file of files) {
      const rel = path.relative(TMP, file).replaceAll("\\", "/")
      fossil(["add", rel])
    }
  }
  fossil(["commit", "-m", "snapshot", "--no-warnings"])
  return getCurrentHash()
}

describe("Fossil Rollback & Undo", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    initRepo()
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  })

  test.skip("update rolls back committed files", () => {
    writeFileSync(path.join(TMP, "a.txt"), "v1")
    writeFileSync(path.join(TMP, "b.txt"), "v1")
    const h1 = track([path.join(TMP, "a.txt"), path.join(TMP, "b.txt")])

    writeFileSync(path.join(TMP, "a.txt"), "v2")
    writeFileSync(path.join(TMP, "b.txt"), "v2")
    track()

    // Rollback to h1 (state is clean, no uncommitted changes)
    fossil(["update", h1])

    expect(readFileSync(path.join(TMP, "a.txt"), "utf-8")).toBe("v1")
    expect(readFileSync(path.join(TMP, "b.txt"), "utf-8")).toBe("v1")
  })

  test("revert restores specific file to current checkout", () => {
    writeFileSync(path.join(TMP, "x.txt"), "original")
    track([path.join(TMP, "x.txt")])

    // Modify locally (not committed)
    writeFileSync(path.join(TMP, "x.txt"), "modified")

    // Revert to checkout version
    fossil(["revert", "x.txt"])
    expect(readFileSync(path.join(TMP, "x.txt"), "utf-8")).toBe("original")
  })

  test("revert -r VERSION restores file to specific version", () => {
    writeFileSync(path.join(TMP, "y.txt"), "v1")
    const h1 = track([path.join(TMP, "y.txt")])

    writeFileSync(path.join(TMP, "y.txt"), "v2")
    track()

    writeFileSync(path.join(TMP, "y.txt"), "v3")
    track()

    // Revert to v1
    fossil(["revert", "y.txt", "-r", h1])
    expect(readFileSync(path.join(TMP, "y.txt"), "utf-8")).toBe("v1")
  })

  test("undo reverts last checkout change", () => {
    writeFileSync(path.join(TMP, "z.txt"), "original")
    track([path.join(TMP, "z.txt")])

    // Modify and revert
    writeFileSync(path.join(TMP, "z.txt"), "changed")
    fossil(["revert", "z.txt"])
    expect(readFileSync(path.join(TMP, "z.txt"), "utf-8")).toBe("original")

    // Undo the revert
    fossil(["undo"])
    expect(readFileSync(path.join(TMP, "z.txt"), "utf-8")).toBe("changed")
  })

  test("opRestore (checkout) preserves version history", () => {
    writeFileSync(path.join(TMP, "d.txt"), "v1")
    const h1 = track([path.join(TMP, "d.txt")])

    writeFileSync(path.join(TMP, "d.txt"), "v2")
    track()

    writeFileSync(path.join(TMP, "d.txt"), "v3")
    const h3 = track()

    // Rollback to v1
    fossil(["update", h1])

    // History should still have all versions
    const timeline = fossil(["timeline"])
    expect(timeline.stdout).toContain("snapshot")

    // Can go back to v3
    fossil(["update", h3])
    expect(readFileSync(path.join(TMP, "d.txt"), "utf-8")).toBe("v3")
  })

  test("rollback to non-existent version fails gracefully", () => {
    writeFileSync(path.join(TMP, "e.txt"), "e")
    track([path.join(TMP, "e.txt")])

    const result = fossil(["checkout", "deadbeef1234567890"])
    expect(result.code).not.toBe(0)
  })

  test.skip("multiple rollbacks don't corrupt history", () => {
    writeFileSync(path.join(TMP, "f.txt"), "v1")
    const h1 = track([path.join(TMP, "f.txt")])

    writeFileSync(path.join(TMP, "f.txt"), "v2")
    const h2 = track()

    writeFileSync(path.join(TMP, "f.txt"), "v3")
    const h3 = track()

    // Rollback to v1, then v3, then v2
    fossil(["update", h1])
    expect(readFileSync(path.join(TMP, "f.txt"), "utf-8")).toBe("v1")

    fossil(["update", h3])
    expect(readFileSync(path.join(TMP, "f.txt"), "utf-8")).toBe("v3")

    fossil(["update", h2])
    expect(readFileSync(path.join(TMP, "f.txt"), "utf-8")).toBe("v2")

    // Timeline still intact
    const timeline = fossil(["timeline"])
    expect(timeline.stdout).toContain("snapshot")
  })
})
