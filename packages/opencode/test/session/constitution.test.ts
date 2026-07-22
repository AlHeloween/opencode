import { describe, expect, test } from "bun:test"
import { Constitution } from "../../src/session/constitution"

describe("session.constitution", () => {
  test("classifyCommandRisk ranks destructive git/rm", () => {
    expect(Constitution.classifyCommandRisk("rm -rf /tmp/x")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git push --force origin main")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git reset --hard HEAD~1")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git checkout main")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git checkout -b feature/x")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git checkout -- path/to/file")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git switch Local_Development")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git restore packages/opencode/src/x.ts")).toBe("DESTRUCTIVE")
  })

  test("git checkout/switch/restore/reset --hard are hard-blocked (not permission-askable)", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      for (const cmd of [
        "git checkout main",
        "git checkout -- path/file.ts",
        "git switch Local_Development",
        "git restore src/x.ts",
        "git reset --hard HEAD~1",
      ]) {
        const g = Constitution.guardCommand(cmd)
        expect(g.blocked).toBe(true)
        expect(g.needsDestructivePermission).toBe(false)
        expect(g.message).toMatch(/BLOCKED|edit-tool|Fossil/i)
      }
      // Other destructive still askable
      const rm = Constitution.guardCommand("rm -rf /tmp/x")
      expect(rm.blocked).toBe(false)
      expect(rm.needsDestructivePermission).toBe(true)
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("classifyCommandRisk ranks elevated write/publish", () => {
    expect(Constitution.classifyCommandRisk("git push origin main")).toBe("ELEVATED")
    expect(Constitution.classifyCommandRisk("npm publish")).toBe("ELEVATED")
  })

  test("classifyCommandRisk treats reads as low", () => {
    expect(Constitution.classifyCommandRisk("ls -la")).toBe("LOW")
    expect(Constitution.classifyCommandRisk("git status")).toBe("LOW")
  })

  test("guardCommand requires destructive permission by default", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      const g = Constitution.guardCommand("rm -rf /tmp/x")
      expect(g.needsDestructivePermission).toBe(true)
      expect(g.risk).toBe("DESTRUCTIVE")
      expect(g.message).toContain("DESTRUCTIVE")
      expect(Constitution.guardCommand("ls").needsDestructivePermission).toBe(false)
      expect(Constitution.guardCommand("git push origin main").needsDestructivePermission).toBe(false)
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("guardCommand skips permission when OPENCODE_ALLOW_DESTRUCTIVE=1", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = "1"
    try {
      const g = Constitution.guardCommand("git push --force origin main")
      expect(g.needsDestructivePermission).toBe(false)
      expect(g.risk).toBe("DESTRUCTIVE")
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("infoMarkAtLeast ranks Exact over Guess", () => {
    expect(Constitution.infoMarkAtLeast("Exact", "Inferred")).toBe(true)
    expect(Constitution.infoMarkAtLeast("Guess", "Exact")).toBe(false)
    expect(Constitution.infoMarkAtLeast("Inferred", "Inferred")).toBe(true)
  })

  test("MEMORY_INFO_MARK maps surfaces", () => {
    expect(Constitution.MEMORY_INFO_MARK.sessionRead).toBe("Exact")
    expect(Constitution.MEMORY_INFO_MARK.summary).toBe("Inferred")
    expect(Constitution.MEMORY_INFO_MARK.unaided).toBe("Guess")
  })

  test("sessionReadExactBanner marks Exact", () => {
    const b = Constitution.sessionReadExactBanner("ses_1")
    expect(b).toContain("info_mark: Exact")
    expect(b).toContain("ses_1")
  })

  // --- epistemic nudge (plans/2026-07-22_epistemic_guardrails.md step B) ---

  test("epistemicNudge: mutation tools get nudge when floor is Inferred", () => {
    for (const tool of ["write", "edit", "multiedit", "apply_patch"]) {
      const n = Constitution.epistemicNudge({ tool, evidenceFloor: "Inferred" })
      expect(n).toBeDefined()
      expect(n).toContain("epistemic nudge")
      expect(n).toContain("Inferred")
      expect(n).toContain("session-read")
    }
  })

  test("epistemicNudge: no nudge when evidence floor is Exact", () => {
    expect(Constitution.epistemicNudge({ tool: "edit", evidenceFloor: "Exact" })).toBeUndefined()
    expect(
      Constitution.epistemicNudge({
        tool: "bash",
        evidenceFloor: "Exact",
        command: "rm -rf /tmp/x",
      }),
    ).toBeUndefined()
  })

  test("epistemicNudge: read-only tools without destructive command skip nudge", () => {
    expect(Constitution.epistemicNudge({ tool: "read", evidenceFloor: "Inferred" })).toBeUndefined()
    expect(Constitution.epistemicNudge({ tool: "messagesearch", evidenceFloor: "Guess" })).toBeUndefined()
    expect(
      Constitution.epistemicNudge({
        tool: "bash",
        evidenceFloor: "Inferred",
        command: "ls -la",
      }),
    ).toBeUndefined()
  })

  test("epistemicNudge: destructive shell command gets nudge on non-Exact floor", () => {
    const n = Constitution.epistemicNudge({
      tool: "bash",
      evidenceFloor: "Guess",
      command: "rm -rf /tmp/x",
    })
    expect(n).toBeDefined()
    expect(n).toContain("Guess")
    expect(n).toContain("session-read recommended")
  })

  test("epistemicNudge: elevated but non-destructive shell skips nudge", () => {
    // git push is ELEVATED, not DESTRUCTIVE — soft gate only for DESTRUCTIVE/mutation
    expect(
      Constitution.epistemicNudge({
        tool: "bash",
        evidenceFloor: "Inferred",
        command: "git push origin main",
      }),
    ).toBeUndefined()
  })
})
