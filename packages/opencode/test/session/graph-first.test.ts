import { describe, expect, test } from "bun:test"
import { afterAll } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import {
  SCANNER_TOOLS,
  graphFirstDisabled,
  graphFirstNote,
  hasCodegraphDir,
  isCodegraphTool,
  noteToolCall,
  markPrebuilt,
  resetGraphFirstState,
  scannerGate,
} from "../../src/session/graph-first"

const withIndex = mkdtempSync(path.join(os.tmpdir(), "gf-with-"))
mkdirSync(path.join(withIndex, ".codegraph"), { recursive: true })
const withoutIndex = mkdtempSync(path.join(os.tmpdir(), "gf-without-"))
const outsideDir = mkdtempSync(path.join(os.tmpdir(), "gf-outside-"))

afterAll(() => {
  rmSync(withIndex, { recursive: true, force: true })
  rmSync(withoutIndex, { recursive: true, force: true })
  rmSync(outsideDir, { recursive: true, force: true })
})

describe("session.graph-first", () => {
  test("isCodegraphTool covers the MCP prefix and the bare name", () => {
    expect(isCodegraphTool("codegraph")).toBe(true)
    expect(isCodegraphTool("codegraphexplore")).toBe(true)
    expect(isCodegraphTool("codegraphcodegraphexplore")).toBe(true)
    expect(isCodegraphTool("CodeGraph")).toBe(true)
    expect(isCodegraphTool("grep")).toBe(false)
    expect(isCodegraphTool("glob")).toBe(false)
  })

  test("graphFirstNote follows layer routing and never refuses", () => {
    const note = graphFirstNote("grep")
    expect(note).toMatch(/codegraph_explore/i)
    expect(note).toMatch(/grep/i)
    expect(note).toMatch(/glob\/list|glob.*list/i)
    expect(note).not.toMatch(/BLOCKED/i)
  })

  test("the FIRST scanner call of a session RUNS with a one-time note", () => {
    resetGraphFirstState("s1")
    const hit = scannerGate({ sessionID: "s1", tool: "grep", worktree: withIndex })
    expect(hit).toBeDefined()
    expect(hit!.note).toMatch(/codegraph/i)
    expect(hit!.note).not.toMatch(/BLOCKED/i)
    // Once-only latch: the second scanner call runs without a note.
    expect(scannerGate({ sessionID: "s1", tool: "grep", worktree: withIndex })).toBeUndefined()
    expect(scannerGate({ sessionID: "s1", tool: "glob", worktree: withIndex })).toBeUndefined()
    expect(scannerGate({ sessionID: "s1", tool: "list", worktree: withIndex })).toBeUndefined()
  })

  test("a codegraph call arms the latch — scanners run note-free after it", () => {
    resetGraphFirstState("s2")
    noteToolCall("s2", "codegraphcodegraphexplore")
    expect(scannerGate({ sessionID: "s2", tool: "grep", worktree: withIndex })).toBeUndefined()
  })

  test("markPrebuilt suppresses the note (control)", () => {
    resetGraphFirstState("s2b")
    markPrebuilt("s2b")
    expect(scannerGate({ sessionID: "s2b", tool: "grep", worktree: withIndex })).toBeUndefined()
  })

  test("non-codegraph calls do NOT arm the latch (control)", () => {
    resetGraphFirstState("s3")
    noteToolCall("s3", "grep")
    noteToolCall("s3", "read")
    expect(scannerGate({ sessionID: "s3", tool: "grep", worktree: withIndex })).toBeDefined()
  })

  test("no .codegraph/ in the worktree — the gate is inert (control)", () => {
    resetGraphFirstState("s4")
    expect(hasCodegraphDir(withoutIndex)).toBe(false)
    expect(scannerGate({ sessionID: "s4", tool: "glob", worktree: withoutIndex })).toBeUndefined()
  })

  test("opt-out env disables the note (control)", () => {
    resetGraphFirstState("s5")
    expect(scannerGate({ sessionID: "s5", tool: "list", worktree: withIndex, env: { OPENCODE_GRAPH_FIRST: "0" } })).toBeUndefined()
  })

  test("a path outside the worktree gets no note and does not consume the latch", () => {
    resetGraphFirstState("s-out")
    const outside = scannerGate({ sessionID: "s-out", tool: "list", worktree: withIndex, target: outsideDir })
    expect(outside).toBeUndefined()
    // The latch is unconsumed: the next in-worktree call still notes.
    const hit = scannerGate({ sessionID: "s-out", tool: "list", worktree: withIndex, target: withIndex })
    expect(hit).toBeDefined()
    expect(hit!.note).not.toMatch(/BLOCKED/i)
    expect(scannerGate({ sessionID: "s-out", tool: "list", worktree: withIndex })).toBeUndefined()
  })

  test("a non-scanner tool is never noted", () => {
    resetGraphFirstState("s6")
    expect(scannerGate({ sessionID: "s6", tool: "read", worktree: withIndex })).toBeUndefined()
    expect(scannerGate({ sessionID: "s6", tool: "bash", worktree: withIndex })).toBeUndefined()
  })

  test("SCANNER_TOOLS is exactly the owner's list", () => {
    expect([...SCANNER_TOOLS].sort()).toEqual(["glob", "grep", "list"])
  })

  test("graphFirstDisabled spellings follow the repo convention", () => {
    for (const v of ["0", "false", "off", "no"]) expect(graphFirstDisabled({ OPENCODE_GRAPH_FIRST: v })).toBe(true)
    expect(graphFirstDisabled({})).toBe(false)
    expect(graphFirstDisabled({ OPENCODE_GRAPH_FIRST: "1" })).toBe(false)
  })
})
