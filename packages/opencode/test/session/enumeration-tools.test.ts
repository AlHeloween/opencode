import { describe, expect, test } from "bun:test"
import {
  ENUMERATION_TOOLS,
  enumerationToolDecision,
  resetEnumerationToolCache,
  resolveEnumerationTool,
} from "../../src/session/enumeration-tools"

/**
 * The enumeration block stopped being absolute. Its real subject was never the command: it was the
 * mismatch between a unix habit and a Windows toolchain, where `ls`/`find`/`cat` either do not
 * exist or mean something else. So the rule is now: the command is legal when a real tool RESOLVES
 * — beside the binary, in the worktree's `tools/`, or on PATH — and the block, when it still
 * stands, says where to put the tool instead of pretending the capability is gone.
 */
describe("enumeration tool resolution", () => {
  test("a tool beside the binary makes the command legal", () => {
    resetEnumerationToolCache()
    const decision = enumerationToolDecision("ls", {
      exeDir: "C:\\bin",
      toolsDir: "C:\\wt\\tools",
      exists: (candidate) => candidate === "C:\\bin\\ls.exe",
      which: () => null,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.path).toBe("C:\\bin\\ls.exe")
    expect(decision.message).toBe("")
  })

  test("the worktree's tools/ counts as well", () => {
    resetEnumerationToolCache()
    const decision = enumerationToolDecision("fd", {
      exeDir: "C:\\bin",
      toolsDir: "D:\\zPython\\opencode\\tools",
      exists: (candidate) => candidate === "D:\\zPython\\opencode\\tools\\fd.exe",
      which: () => null,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.path).toContain("tools")
  })

  test("PATH counts for an unambiguous name", () => {
    resetEnumerationToolCache()
    const found = resolveEnumerationTool("rg", {
      exeDir: "C:\\bin",
      toolsDir: "C:\\wt\\tools",
      exists: () => false,
      which: (name) => (name === "rg" ? "C:\\Program Files\\ripgrep\\rg.exe" : null),
    })
    expect(found).toContain("rg.exe")
  })

  test("a Windows namesake is NOT evidence — System32's find is a text search, not a walker", () => {
    // Measured 2026-09-21: `find /c "??"` (grep-shaped, and correct on Windows) was refused as
    // «directory/file enumeration» because `where find` found System32\find.exe. Treating that as
    // the unix tool is the wrong-decision class the owner called out.
    resetEnumerationToolCache()
    const found = resolveEnumerationTool("find", {
      exeDir: "C:\\bin",
      toolsDir: "C:\\wt\\tools",
      exists: () => false,
      which: () => "C:\\Windows\\System32\\find.exe",
    })
    expect(found).toBeUndefined()

    // ...while a real unix build beside the binary is exactly what turns it back on.
    resetEnumerationToolCache()
    const installed = resolveEnumerationTool("find", {
      exeDir: "C:\\bin",
      toolsDir: "C:\\wt\\tools",
      exists: (candidate) => candidate === "C:\\bin\\find.exe",
      which: () => null,
    })
    expect(installed).toBe("C:\\bin\\find.exe")
  })

  test("an absent tool blocks, and the message names both ways out", () => {
    resetEnumerationToolCache()
    const decision = enumerationToolDecision("ls", {
      exeDir: "C:\\bin",
      toolsDir: "C:\\wt\\tools",
      exists: () => false,
      which: () => null,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toContain("C:\\bin")
    expect(decision.message).toContain("tools")
    expect(decision.message).toMatch(/do not use it/i)
  })

  test("the covered names are the ones the block names", () => {
    for (const name of ["ls", "find", "cat", "fd", "grep", "sed"]) {
      expect(ENUMERATION_TOOLS as readonly string[]).toContain(name)
    }
  })
})
