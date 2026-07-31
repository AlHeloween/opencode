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
        "git stash pop",
        "git stash apply",
        "git stash drop",
        "git stash clear",
        "git stash branch wip",
      ]) {
        const g = Constitution.guardCommand(cmd)
        expect(g.blocked).toBe(true)
        expect(g.needsDestructivePermission).toBe(false)
        expect(g.message).toMatch(/BLOCKED|edit-tool|Fossil|stash/i)
      }
      // stash push (save WIP) is not hard-blocked — only pop/apply/drop/clear/branch
      expect(Constitution.guardCommand("git stash push -m save").blocked).toBe(false)
      expect(Constitution.guardCommand("git stash").blocked).toBe(false)
      // File destructive askable under destructive-file (not git)
      const rm = Constitution.guardCommand("rm -rf /tmp/x")
      expect(rm.blocked).toBe(false)
      expect(rm.needsDestructivePermission).toBe(true)
      expect(rm.permission).toBe("destructive-file")
      expect(rm.kind).toBe("file")
      // Force-push under destructive-git
      const fp = Constitution.guardCommand("git push --force origin main")
      expect(fp.blocked).toBe(false)
      expect(fp.needsDestructivePermission).toBe(true)
      expect(fp.permission).toBe("destructive-git")
      expect(fp.kind).toBe("git")
      // DROP TABLE under destructive-db (not file)
      const drop = Constitution.guardCommand("DROP TABLE users;")
      expect(drop.blocked).toBe(false)
      expect(drop.needsDestructivePermission).toBe(true)
      expect(drop.permission).toBe("destructive-db")
      expect(drop.kind).toBe("db")
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("agent fossil commit/add/checkout are hard-blocked (snapshot is runtime-only)", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      for (const cmd of [
        "fossil commit -m 'oops'",
        "fossil.exe commit -m x",
        "fossil add file.ts",
        "fossil checkout tip",
        "fossil update",
      ]) {
        const g = Constitution.guardCommand(cmd)
        expect(g.blocked).toBe(true)
        expect(g.message).toMatch(/fossil|auto-snapshot|git/i)
      }
      // Read-only fossil CLI not hard-blocked by mutate list
      expect(Constitution.guardCommand("fossil timeline").blocked).toBe(false)
      expect(Constitution.guardCommand("fossil status").blocked).toBe(false)
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

  test("guardCommand blocks shell directory and file enumeration in every supported shell form", () => {
    for (const command of [
      "ls -la",
      "dir /a",
      "Get-ChildItem -Force",
      "gci .",
      "tree /f",
      "find . -type f",
      "fd.exe --hidden",
      "rg --hidden --files",
      "git -C repo ls-files",
      "busybox find .",
      "cmd /c dir",
      "powershell -Command Get-ChildItem",
      "powershell -Command ls",
      "powershell -NoLogo -Command ls",
      "powershell -ExecutionPolicy Bypass -Command ls",
      "sh -c \"ls\"",
      "command rg --files",
      "sudo rg --files",
      "sudo -u root rg --files",
      "env -i A=1 rg --files",
      "command -- rg --files",
      "git --work-tree=/x ls-files",
      "git --git-dir=/x ls-files",
      "git status && ls",
      "echo *",
      "for f in **/*; do echo $f; done",
      "for /r %f in (*) do @echo %f",
      "for %%f in (*) do @echo %%f",
      "Resolve-Path *",
      "where /r . *.ts",
    ]) {
      const guard = Constitution.guardCommand(command)
      expect(guard.blocked).toBe(true)
      expect(guard.message).toContain("list tool")
    }
  })

  test("guardCommand preserves ordinary commands and content search", () => {
    for (const command of [
      "git status",
      "rg 'TODO' src",
      "rg \"Get-ChildItem\" src",
      "rg \"git ls-files\" docs",
      "rg \"foo|Get-ChildItem\" src",
      "rg \"foo; Get-ChildItem\" src",
      "rg \"foo|git ls-files\" src",
      "echo ls",
      "node -e \"console.log('ls')\"",
    ]) {
      expect(Constitution.guardCommand(command).blocked).toBe(false)
    }
  })

  test("coverage gate: tier1 FS enumerators blocked; VCS/PATH oracles allowed", () => {
    // Tier 1 — real problem: pure FS enumerators covered 1:1 by list/glob
    for (const command of ["ls", "dir /b", "find .", "fd .", "rg --files", "gci", "tree"]) {
      expect(Constitution.isShellDirectoryBrowsing(command)).toBe(true)
    }
    // Content search is grep-covered → shell rg without --files stays allowed
    expect(Constitution.isShellDirectoryBrowsing("rg TODO src")).toBe(false)
    // PATH lookup not covered by list/glob → allow
    expect(Constitution.isShellDirectoryBrowsing("where.exe node")).toBe(false)
    expect(Constitution.isShellDirectoryBrowsing("which rg")).toBe(false)
  })

  test("git ls-files: block list/glob equivalents; allow VCS oracles tools cannot answer", () => {
    // Covered by glob/list → block
    for (const command of [
      "git ls-files",
      "git -C repo ls-files",
      "git ls-files --others --exclude-standard",
      "git ls-files '*.ts'",
      "git ls-files -- '**/*.json'",
    ]) {
      expect(Constitution.isShellDirectoryBrowsing(command)).toBe(true)
      expect(Constitution.guardCommand(command).blocked).toBe(true)
    }
    // Not covered by list/glob → allow (do not force shell alternatives that cannot answer)
    for (const command of [
      "git ls-files --error-unmatch config.json",
      "git ls-files --error-unmatch config.json 2>&1 && echo TRACKED || echo NOT_TRACKED",
      "git ls-files config.json",
      "git ls-files -- config.json",
      "git -C repo ls-files --error-unmatch packages/opencode/package.json",
      "git --no-pager ls-files -s -- src/session/constitution.ts",
      "git ls-files -m",
      "git ls-files --modified -- src/foo.ts",
      "git ls-files -d",
    ]) {
      expect(Constitution.isShellDirectoryBrowsing(command)).toBe(false)
      expect(Constitution.guardCommand(command).blocked).toBe(false)
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
    for (const tool of ["write", "edit", "multiedit", "applypatch"]) {
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
    expect(n).toContain("session-read")
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

  // --- claim ledger / grounding gate ---

  test("self-Exact without stamp is demoted to Hypothetical", () => {
    Constitution.resetEpistemicState("ses_claim_1")
    const r = Constitution.ingestAssistantText(
      "ses_claim_1",
      `
claim_ledger:
  claims:
    - id: C1
      text: "sidecar is invisible in M"
      status: Exact
      reason: "I think so"
  premises_for_plan: [C1]
  open_questions: []
`,
    )
    expect(r.demoted).toContain("C1")
    const led = Constitution.getClaimLedger("ses_claim_1")
    expect(led.claims.get("C1")?.status).toBe("Hypothetical")
    expect(led.claims.get("C1")?.stamped).toBe(false)
  })

  test("oracle_stamp promotes claim to Exact and grounds premises", () => {
    Constitution.resetEpistemicState("ses_claim_2")
    Constitution.ingestAssistantText(
      "ses_claim_2",
      `
claim_ledger:
  claims:
    - id: C1
      text: "open window uses chars/4"
      status: Hypothetical
      falsifier: "read computeOpenWindowTokens"
  premises_for_plan: [C1]
`,
    )
    expect(Constitution.premisesGrounded("ses_claim_2").ok).toBe(false)
    expect(Constitution.guardMutationGrounding({ sessionID: "ses_claim_2", tool: "edit" }).blocked).toBe(true)

    Constitution.ingestAssistantText("ses_claim_2", "oracle_stamp: C1 PASS")
    expect(Constitution.hasStamp("ses_claim_2", "C1")).toBe(true)
    expect(Constitution.getClaimLedger("ses_claim_2").claims.get("C1")?.status).toBe("Exact")
    expect(Constitution.premisesGrounded("ses_claim_2").ok).toBe(true)
    expect(Constitution.guardMutationGrounding({ sessionID: "ses_claim_2", tool: "edit" }).blocked).toBe(false)
  })

  test("no active ledger does not block mutation", () => {
    Constitution.resetEpistemicState("ses_claim_3")
    expect(Constitution.guardMutationGrounding({ sessionID: "ses_claim_3", tool: "write" }).blocked).toBe(false)
  })

  test("isGroundingMark and parseInfoMark", () => {
    expect(Constitution.isGroundingMark("Exact")).toBe(true)
    expect(Constitution.isGroundingMark("Inferred")).toBe(true)
    expect(Constitution.isGroundingMark("Hypothetical")).toBe(false)
    expect(Constitution.parseInfoMark("exact")).toBe("Exact")
    expect(Constitution.parseInfoMark("nope")).toBe("Unknown")
  })

  test("evidenceUpgradeForTool maps inspection tools", () => {
    expect(Constitution.evidenceUpgradeForTool("session-read")).toBe("Exact")
    expect(Constitution.evidenceUpgradeForTool("read")).toBe("Exact")
    expect(Constitution.evidenceUpgradeForTool("grep")).toBe("Inferred")
    expect(Constitution.evidenceUpgradeForTool("edit")).toBeUndefined()
  })

  test("where /r recursive file enum is blocked; bare where for PATH is not", () => {
    expect(Constitution.isShellDirectoryBrowsing("where /r . *.ts")).toBe(true)
    expect(Constitution.guardCommand("where /r . *.ts").blocked).toBe(true)
    // PATH lookup (WHERE_WHICH) is not directory browsing
    expect(Constitution.isShellDirectoryBrowsing("where.exe node")).toBe(false)
    expect(Constitution.guardCommand("where.exe node").blocked).toBe(false)
  })

  test("oracle_stamp then claim_ledger Exact is allowed when stamped", () => {
    Constitution.resetEpistemicState("ses_claim_4")
    Constitution.ingestAssistantText("ses_claim_4", "oracle_stamp: C9 PASS")
    Constitution.ingestAssistantText(
      "ses_claim_4",
      `
claim_ledger:
  claims:
    - id: C9
      text: "smoke passed"
      status: Exact
  premises_for_plan: [C9]
`,
    )
    expect(Constitution.getClaimLedger("ses_claim_4").claims.get("C9")?.status).toBe("Exact")
    expect(Constitution.getClaimLedger("ses_claim_4").claims.get("C9")?.stamped).toBe(true)
    expect(Constitution.premisesGrounded("ses_claim_4").ok).toBe(true)
  })
})
