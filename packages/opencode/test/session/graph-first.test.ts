import { describe, expect, test } from "bun:test"
import { afterAll } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import {
  SCANNER_TOOLS,
  graphFirstDisabled,
  hasCodegraphDir,
  isCodegraphTool,
  noteToolCall,
  resetGraphFirstState,
  scannerGate,
} from "../../src/session/graph-first"

const withIndex = mkdtempSync(path.join(os.tmpdir(), "gf-with-"))
mkdirSync(path.join(withIndex, ".codegraph"))
const withoutIndex = mkdtempSync(path.join(os.tmpdir(), "gf-without-"))

afterAll(() => {
  rmSync(withIndex, { recursive: true, force: true })
  rmSync(withoutIndex, { recursive: true, force: true })
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

  test("the FIRST scanner call of a session is refused once, with the route", () => {
    resetGraphFirstState("s1")
    const hit = scannerGate({ sessionID: "s1", tool: "grep", worktree: withIndex })
    expect(hit).toBeDefined()
    expect(hit!.message).toMatch(/codegraph/i)
    // Once-only latch: the second scanner call runs freely.
    expect(scannerGate({ sessionID: "s1", tool: "grep", worktree: withIndex })).toBeUndefined()
    expect(scannerGate({ sessionID: "s1", tool: "glob", worktree: withIndex })).toBeUndefined()
    expect(scannerGate({ sessionID: "s1", tool: "list", worktree: withIndex })).toBeUndefined()
  })

  test("a codegraph call arms the latch — scanners run freely after it", () => {
    resetGraphFirstState("s2")
    noteToolCall("s2", "codegraphcodegraphexplore")
    expect(scannerGate({ sessionID: "s2", tool: "grep", worktree: withIndex })).toBeUndefined()
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

  test("opt-out env disables the gate (control)", () => {
    resetGraphFirstState("s5")
    expect(scannerGate({ sessionID: "s5", tool: "list", worktree: withIndex, env: { OPENCODE_GRAPH_FIRST: "0" } })).toBeUndefined()
  })

  test("a non-scanner tool is never gated", () => {
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
