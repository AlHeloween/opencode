import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import os from "os"

// Fixture: an isolated fossil repo with check-ins carrying the semantic-vector
// comment shape the snapshot system writes (docs/fossil-snapshot.md §2.0.1):
//   auto-snapshot sv:<md5> dominant=<sentence> Keywords: k w, k w … md5: …
// plus a bare `auto-snapshot` check-in that carries no vector.

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
const TMP = path.join(os.tmpdir(), `fossilgrep_comments_${Date.now()}`)
const REPO = path.join(TMP, "probe.fsl")

const SV_MD5 = "aaaabbbbccccdddd1111222233334444"
const SV_COMMENT =
  `auto-snapshot sv:${SV_MD5} dominant=probe dominant text about deduplication ` +
  `Keywords: dedup 0.50, probe 0.50 md5: ${SV_MD5} prev-md5: 00000000000000000000000000000000 ` +
  `parent-goal-md5: 00000000000000000000000000000000`

function fossil(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: cwd ?? TMP, encoding: "utf-8", timeout: 15000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  fossil(["init", REPO])
  fossil(["open", REPO, "--keep", "--nested"])
  writeFileSync(path.join(TMP, "a.txt"), "alpha content\n")
  fossil(["add", "a.txt"])
  fossil(["commit", "-m", SV_COMMENT, "--no-warnings"])
  writeFileSync(path.join(TMP, "b.txt"), "beta content\n")
  fossil(["add", "b.txt"])
  fossil(["commit", "-m", "auto-snapshot", "--no-warnings"])
})

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {}
})

describe("fossilgrep comment mode", () => {
  test("searchComments finds a check-in by its dominant text", () => {
    const { searchComments } = require("../../src/tool/fossilgrep")
    const results = searchComments(REPO, "deduplication")
    expect(results.length).toBeGreaterThanOrEqual(1)
    const hit = results.find((r: any) => r.sv === SV_MD5)
    expect(hit).toBeDefined()
    expect(hit.dominant).toContain("deduplication")
    expect(hit.comment).toContain("auto-snapshot")
    expect(hit.files).toContain("a.txt")
    expect(hit.date).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  test("searchComments finds a check-in by its sv md5", () => {
    const { searchComments } = require("../../src/tool/fossilgrep")
    const results = searchComments(REPO, SV_MD5)
    expect(results.length).toBe(1)
    expect(results[0].sv).toBe(SV_MD5)
  })

  test("searchComments matches bare auto-snapshot check-ins too", () => {
    const { searchComments } = require("../../src/tool/fossilgrep")
    const results = searchComments(REPO, "^auto-snapshot$")
    expect(results.length).toBe(1)
    const bare = results.find((r: any) => !r.sv)
    expect(bare).toBeDefined()
    expect(bare.files).toContain("b.txt")
    // The vector check-in does NOT match the bare pattern — the regex is exact.
    expect(results.find((r: any) => r.sv === SV_MD5)).toBeUndefined()
    expect(bare.files).toContain("b.txt")
  })

  test("searchComments respects maxResults and ignoreCase", () => {
    const { searchComments } = require("../../src/tool/fossilgrep")
    const caseInsensitive = searchComments(REPO, "DEDUPLICATION", { ignoreCase: true })
    expect(caseInsensitive.length).toBeGreaterThanOrEqual(1)
    const caseSensitive = searchComments(REPO, "DEDUPLICATION")
    expect(caseSensitive.length).toBe(0)
    const limited = searchComments(REPO, ".", { maxResults: 1 })
    expect(limited.length).toBe(1)
  })

  test("searchComments returns no matches for a pattern nothing carries", () => {
    const { searchComments } = require("../../src/tool/fossilgrep")
    const results = searchComments(REPO, "zzz-no-such-thing")
    expect(results.length).toBe(0)
  })

  test("searchComments names a repo that cannot be opened instead of throwing", () => {
    const { searchComments } = require("../../src/tool/fossilgrep")
    const missing = path.join(TMP, "does-not-exist.fsl")
    expect(() => searchComments(missing, "x")).toThrow(/does-not-exist\.fsl/)
  })
})
