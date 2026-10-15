import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { execFileSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import os from "os"

// The project cell (plan 2026-10-15_project-fossil-cell.md B4): the wiki card and the chat
// technote live IN the snapshot repo. Real fossil binary, real repo — no mocks.

import { cellCardMarkdown, ensureWikiCard, postChatReport } from "../../src/snapshot/cell"

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
const TMP = path.join(os.tmpdir(), `fossil_cell_${Date.now()}`)
const REPO = path.join(TMP, "snapshot.fsl")

function fossil(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(FOSSIL, args, { cwd: cwd ?? TMP, encoding: "utf-8", timeout: 15000 })
    return { code: 0, stdout, stderr: "" }
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" }
  }
}

function wikiEvents(): number {
  return Number(fossil(["sql", "-R", REPO, "SELECT count(*) FROM event WHERE type='w'"]).stdout.trim())
}

function technoteComments(): string {
  return fossil(["sql", "-R", REPO, "SELECT comment FROM event WHERE type='e' ORDER BY mtime DESC"]).stdout
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  fossil(["init", REPO])
  fossil(["open", REPO, "--keep", "--nested"])
  writeFileSync(path.join(TMP, "AGENTS.md"), "# rules\n")
  writeFileSync(path.join(TMP, "a.txt"), "alpha\n")
  fossil(["add", "a.txt"])
  fossil(["commit", "-m", "auto-snapshot", "--no-warnings"])
})

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {}
})

describe("project cell", () => {
  test("cellCardMarkdown lists only pointers whose target exists", () => {
    const withAgents = cellCardMarkdown(TMP)
    expect(withAgents).toContain("AGENTS.md")
    expect(withAgents).not.toContain("docs/README.md") // not created in the fixture
    const empty = cellCardMarkdown(path.join(TMP, "no-such-dir"))
    expect(empty).toContain("no standard project documents found on disk")
  })

  test("ensureWikiCard creates the Project page and is idempotent", async () => {
    expect(await ensureWikiCard(FOSSIL, REPO, TMP)).toBe(true)
    const exported = fossil(["wiki", "-R", REPO, "export", "Project", "-"]).stdout
    expect(exported).toContain("AGENTS.md")
    expect(exported).toContain("one-copy rule")
    expect(wikiEvents()).toBe(1)
    // second call: no new version
    expect(await ensureWikiCard(FOSSIL, REPO, TMP)).toBe(true)
    expect(wikiEvents()).toBe(1)
  })

  test("postChatReport writes one technote per call with agent + dominant + session", async () => {
    const sign = "sv:aaaabbbbccccdddd1111222233334444 dominant=probe dominant text about the cell"
    expect(await postChatReport(FOSSIL, REPO, TMP, { sessionID: "ses_test1234567890", agent: "build_mode", sign })).toBe(true)
    const comments = technoteComments()
    expect(comments).toContain("chat build_mode sv:aaaabbbbccccdddd1111222233334444: probe dominant text about the cell (session ses_test")
    expect(comments).toContain("aaaabbbbccccdddd1111222233334444")
    // a second report is a SECOND technote — the chat is a timeline, not a page
    expect(await postChatReport(FOSSIL, REPO, TMP, { sessionID: "ses_other12345678", agent: "build_mode" })).toBe(true)
    expect(technoteComments().split("\n").filter((l) => l.includes("chat build_mode")).length).toBe(2)
    // no vector declared reads as exactly that
    expect(technoteComments()).toContain("no vector declared")
  })

  test("a repo that cannot be written is a false, never a throw", async () => {
    const missing = path.join(TMP, "does-not-exist.fsl")
    expect(await postChatReport(FOSSIL, missing, TMP, { sessionID: "ses_x" })).toBe(false)
    expect(await ensureWikiCard(FOSSIL, missing, TMP)).toBe(false)
  })
})
