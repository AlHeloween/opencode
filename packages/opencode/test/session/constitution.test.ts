import { describe, expect, test } from "bun:test"
import { Constitution } from "../../src/session/constitution"

describe("session.constitution", () => {
  test("classifyCommandRisk ranks destructive git/rm", () => {
    expect(Constitution.classifyCommandRisk("rm -rf /tmp/x")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git push --force origin main")).toBe("DESTRUCTIVE")
    expect(Constitution.classifyCommandRisk("git reset --hard HEAD~1")).toBe("DESTRUCTIVE")
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
})
