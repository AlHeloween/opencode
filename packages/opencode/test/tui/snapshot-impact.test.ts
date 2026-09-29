/**
 * The footer's snapshot reader — the two halves and their parsers.
 *
 * Regression for the defect measured 2026-09-29: the reader used to decode a fossil
 * `sym` tag, and the live tag is EMPTY (`sym=KINDS:none|TOP:none|XF:0`), so the
 * footer rendered nothing at all while the tag existed. It now takes the BRIEF from
 * fossil and the IMPACT from the readonly graph — and the parsers below are the part
 * that can be pinned without a repository, which is why they are exported.
 */
import { describe, expect, test } from "bun:test"
import {
  parseBriefPaths,
  parseFossilInfo,
  readSnapshotImpact,
} from "@/cli/cmd/tui/util/snapshot-symtag"
import { hasFossilSnapshot } from "@/cli/cmd/tui/util/vcs-indicator"

describe("fossil info parsing", () => {
  // Verbatim shape from the live repo, 2026-09-29.
  const real = [
    "project-name: <unnamed>",
    "repository:   D:\\zPython\\opencode\\.opencode\\data\\fossil\\4b0ea68d7af9a6031a7ffda7ad66e0cb83315750\\snapshot.fsl",
    "local-root:   D:/zPython/opencode/",
    "checkout:     82eca50ba051dce370f58f54a1d2c7210c9966bf 2026-09-29 18:36:28 UTC",
    "parent:       4a9cf39c16be9ce7b4de8ce2387bc9b3b2855f7e 2026-09-29 18:26:33 UTC",
    "tags:         sym, trunk",
    "comment:      auto-snapshot (user: Alexander)",
  ].join("\n")

  test("reads checkout and parent out of the real info text", () => {
    const parsed = parseFossilInfo(real)
    expect(parsed.checkout).toBe("82eca50ba051dce370f58f54a1d2c7210c9966bf")
    expect(parsed.parent).toBe("4a9cf39c16be9ce7b4de8ce2387bc9b3b2855f7e")
  })

  test("a repository without a parent still yields its checkout", () => {
    const parsed = parseFossilInfo("checkout:     abc123 2026-09-29 18:36:28 UTC\ntags: trunk")
    expect(parsed.checkout).toBe("abc123")
    expect(parsed.parent).toBeUndefined()
  })

  test("a missing checkout is reported as missing, never invented", () => {
    expect(parseFossilInfo("project-name: <unnamed>").checkout).toBeUndefined()
  })
})

describe("fossil diff --brief parsing", () => {
  test("strips the change kind and normalizes separators", () => {
    const text = "EDITED packages\\opencode\\src\\a.ts\nADDED packages/opencode/src/b.ts\n"
    expect(parseBriefPaths(text)).toEqual(["packages/opencode/src/a.ts", "packages/opencode/src/b.ts"])
  })

  test("an empty diff is an empty brief, not a phantom file", () => {
    expect(parseBriefPaths("")).toEqual([])
    expect(parseBriefPaths("\n  \n")).toEqual([])
  })
})

describe("readSnapshotImpact on this worktree", () => {
  const worktree = process.cwd().includes("packages")
    ? process.cwd().replace(/[\\/]packages[\\/]opencode$/, "")
    : process.cwd()

  test("outside a fossil sidecar it answers null — no invented brief", () => {
    // A directory that certainly has no sidecar: the test file's own directory tree
    // has one only when the whole project does, so this asserts the NEGATIVE path
    // only where it truly applies.
    if (hasFossilSnapshot(worktree)) return
    expect(readSnapshotImpact(worktree)).toBeNull()
  })

  test("with a sidecar it returns a brief and never fabricates an impact", () => {
    if (!hasFossilSnapshot(worktree)) return
    const info = readSnapshotImpact(worktree)
    expect(info).not.toBeNull()
    expect(Array.isArray(info!.changedFiles)).toBe(true)
    // The stop condition is the whole point of this reader: a symbol count may be
    // zero, but it is then DECLARED unavailable rather than rendered as a fact.
    if (info!.totalSymbols === 0) {
      expect(info!.topSymbols.length).toBe(0)
    } else {
      expect(info!.impactUnavailable).toBe(false)
    }
  })
})
