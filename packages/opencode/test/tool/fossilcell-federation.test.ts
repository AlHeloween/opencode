import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import os from "os"

// Phase C (plan 2026-10-15_project-fossil-cell.md): the federation. The registry parse and the
// project-name derivation are pure; the cross-project comment search runs against real repos.

import {
  parseRepoList,
  projectNameOf,
  searchComments,
} from "../../src/tool/fossilgrep"

function findFossil(): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "tools", "fossil.exe"),
    path.join(process.cwd(), "..", "..", "external", "fossil", "fossil.exe"),
  ]
  for (const c of candidates) {
    const resolved = path.resolve(c)
    if (existsSync(resolved)) return resolved
  }
  throw new Error("fossil not found")
}

const FOSSIL = findFossil()
const TMP = path.join(os.tmpdir(), `fossil_federation_${Date.now()}`)
const REPO_A = path.join(TMP, "proj-a", ".opencode", "data", "fossil", "id-a", "snapshot.fsl")
const REPO_B = path.join(TMP, "proj-b", ".opencode", "data", "fossil", "id-b", "snapshot.fsl")

function fossil(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: cwd ?? TMP, encoding: "utf-8", timeout: 15000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

function makeRepo(repo: string, dominant: string) {
  const dir = path.dirname(repo)
  mkdirSync(dir, { recursive: true })
  const worktree = path.join(dir, "wt")
  mkdirSync(worktree, { recursive: true })
  fossil(["init", repo], worktree)
  fossil(["open", repo, "--keep", "--nested"], worktree)
  writeFileSync(path.join(worktree, "f.txt"), "x\n")
  fossil(["add", "f.txt"], worktree)
  fossil(
    ["commit", "-m", `auto-snapshot sv:1111222233334444aaaabbbbccccdddd dominant=${dominant} Keywords: x 0.5 md5: 1111222233334444aaaabbbbccccdddd prev-md5: 00000000000000000000000000000000 parent-goal-md5: 00000000000000000000000000000000`, "--no-warnings"],
    worktree,
  )
  return worktree
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  makeRepo(REPO_A, "dedup map delivered for the syndicate")
  makeRepo(REPO_B, "kernel repair shipped in another project")
})

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {}
})

describe("federation registry", () => {
  test("parseRepoList keeps only snapshot.fsl entries", () => {
    const sample = [
      "C:/Users/Alexander/.org/org.fossil",
      "D:/zPython/opencode/.opencode/data/fossil/4b0ea68d/snapshot.fsl",
      "D:/zPython/Smit/.smit/data/fossil/db95d6b7/snapshot.fsl",
      "C:/Users/ALEXAN~1/AppData/Local/Temp/forum-probe-3hviut51/scratch.fossil",
      "",
    ].join("\n")
    expect(parseRepoList(sample)).toEqual([
      "D:/zPython/opencode/.opencode/data/fossil/4b0ea68d/snapshot.fsl",
      "D:/zPython/Smit/.smit/data/fossil/db95d6b7/snapshot.fsl",
    ])
  })

  test("projectNameOf derives the worktree dir for both layouts", () => {
    expect(projectNameOf("D:/zPython/opencode/.opencode/data/fossil/4b0ea68d/snapshot.fsl")).toBe("opencode")
    expect(projectNameOf("D:/zPython/Smit/.smit/data/fossil/db95d6b7/snapshot.fsl")).toBe("Smit")
    expect(projectNameOf("D:/some/repo/data/fossil/x/snapshot.fsl")).toBe("repo")
  })
})

describe("cross-project comment search", () => {
  test("searchComments finds the dominant in each registered repo", () => {
    const a = searchComments(REPO_A, "syndicate")
    expect(a.length).toBe(1)
    expect(a[0]!.dominant).toContain("dedup map delivered")
    expect(a[0]!.files).toContain("f.txt")
    const b = searchComments(REPO_B, "kernel repair")
    expect(b.length).toBe(1)
    expect(b[0]!.dominant).toContain("kernel repair shipped")
  })

  test("a pattern nothing carries returns zero per repo, not an error", () => {
    expect(searchComments(REPO_A, "zzz-no-such-thing").length).toBe(0)
  })

  test("a repo that fails to open is NAMED, never silent", () => {
    const missing = path.join(TMP, "proj-c", ".opencode", "data", "fossil", "id-c", "snapshot.fsl")
    expect(() => searchComments(missing, "x")).toThrow(/proj-c/)
  })
})
