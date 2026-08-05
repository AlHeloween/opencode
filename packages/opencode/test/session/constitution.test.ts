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
    const isWin = process.platform === "win32"

    // Cross-platform — blocked on any OS
    const crossPlatform = [
      "tree /f",
      "find . -type f",
      "echo *",
      "for f in **/*; do echo $f; done",
    ]
    for (const command of crossPlatform) {
      const guard = Constitution.guardCommand(command)
      expect(guard.blocked).toBe(true)
      expect(guard.message).toContain("list tool")
    }

    // Windows-only builtins / cmdlets
    if (isWin) {
      for (const command of [
        "dir /a",
        "Get-ChildItem -Force",
        "gci .",
        "Resolve-Path *",
        "cmd /c dir",
        "powershell -Command Get-ChildItem",
        "for /r %f in (*) do @echo %f",
        "for %%f in (*) do @echo %%f",
      ]) {
        const guard = Constitution.guardCommand(command)
        expect(guard.blocked).toBe(true)
        expect(guard.message).toContain("list tool")
      }
      // `ls`/`cat` don't exist on native Windows → not blocked
      expect(Constitution.guardCommand("ls -la").blocked).toBe(false)
      expect(Constitution.guardCommand("sh -c \"ls\"").blocked).toBe(false)
    } else {
      // Linux-only
      for (const command of [
        "ls -la",
        "sh -c \"ls\"",
      ]) {
        const guard = Constitution.guardCommand(command)
        expect(guard.blocked).toBe(true)
        expect(guard.message).toContain("list tool")
      }
      // `dir`/`gci` don't exist on Linux → not blocked
      expect(Constitution.guardCommand("dir /a").blocked).toBe(false)
      expect(Constitution.guardCommand("gci .").blocked).toBe(false)
    }

    // PATH-conditional: only blocked if binary exists on this system
    // `git status && ls` — `ls` segment on Linux gets blocked; on Windows `ls` doesn't exist
    if (isWin) {
      expect(Constitution.guardCommand("git status && ls").blocked).toBe(false)
    } else {
      expect(Constitution.guardCommand("git status && ls").blocked).toBe(true)
    }

    // `rg --files` / `fd` / `busybox` — conditional on PATH; skip assertion
    // `sudo rg --files` — `rg` gated by PATH
    // `command rg --files` — `rg` gated by PATH
    // `powershell -Command ls` — on Windows: PS exists but `ls` may be an alias; conservatively allow
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
    // Tier 1 — pure FS enumerators covered 1:1 by list/glob
    // Platform-aware: only block commands that actually exist on this OS
    // Uses legacy guardCommand (string-based, no TreeSitter needed for these checks)

    // Cross-platform (exist on both Windows and Linux)
    for (const command of ["find .", "tree"]) {
      expect(Constitution.guardCommand(command).blocked).toBe(true)
    }

    // Platform-specific builtins
    if (process.platform === "win32") {
      for (const command of ["dir /b", "gci", "type file.txt"]) {
        expect(Constitution.guardCommand(command).blocked).toBe(true)
      }
      // `ls` does NOT exist on native Windows → no block
      expect(Constitution.guardCommand("ls").blocked).toBe(false)
      // `cat` does NOT exist on native Windows → no block
      expect(Constitution.guardCommand("cat file.txt").blocked).toBe(false)
    } else {
      for (const command of ["ls", "cat file.txt"]) {
        expect(Constitution.guardCommand(command).blocked).toBe(true)
      }
      // `dir` does NOT exist on Linux → no block
      expect(Constitution.guardCommand("dir /b").blocked).toBe(false)
      // `gci` does NOT exist on Linux → no block
      expect(Constitution.guardCommand("gci").blocked).toBe(false)
    }

    // External tools — only blocked if present on PATH
    if (process.platform === "win32") {
      // `find` is a cmd.exe builtin-analogue on Windows → always present
      expect(Constitution.guardCommand("find .").blocked).toBe(true)
    }
    // rg TODO src is content search → allowed
    expect(Constitution.guardCommand("rg TODO src").blocked).toBe(false)
    // PATH lookup not covered by list/glob → allow
    expect(Constitution.guardCommand("where.exe node").blocked).toBe(false)
    expect(Constitution.guardCommand("which rg").blocked).toBe(false)
  })

  test("git ls-files: always allowed — VCS oracle, not a list/glob substitute", () => {
    for (const command of [
      "git ls-files",
      "git -C repo ls-files",
      "git ls-files --others --exclude-standard",
      "git ls-files '*.ts'",
      "git ls-files -- '**/*.json'",
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
      expect(Constitution.guardCommand(command).blocked).toBe(false)
    }
  })

  test("where /r and bare where for PATH are not enumeration — both allowed", () => {
    // where /r is recursive PATH-aware search, not pure file enumeration
    expect(Constitution.guardCommand("where /r . *.ts").blocked).toBe(false)
    // PATH lookup (WHERE_WHICH) is not directory browsing
    expect(Constitution.guardCommand("where.exe node").blocked).toBe(false)
  })

  test("git ls-files: always allowed — VCS oracle, not a list/glob substitute", () => {
    // git ls-files answers "what does git track?" — fundamentally different
    // from glob/list which answer "what's on disk?".  All variants are VCS
    // oracles that product tools cannot replicate.
    for (const command of [
      "git ls-files",
      "git -C repo ls-files",
      "git ls-files --others --exclude-standard",
      "git ls-files '*.ts'",
      "git ls-files -- '**/*.json'",
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

  test("where /r and bare where for PATH are not enumeration — both allowed", () => {
    // where /r is recursive PATH-aware search, not pure file enumeration
    expect(Constitution.guardCommand("where /r . *.ts").blocked).toBe(false)
    // PATH lookup (WHERE_WHICH) is not directory browsing
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

  // ── AST-based classification (classifyAstNode / evaluate) ──

  test("classifyAstNode: fossil commands are DESTRUCTIVE", () => {
    for (const sub of ["commit", "ci", "add", "rm", "delete", "addremove", "checkout", "co", "update", "up", "merge", "undo", "revert", "close", "open", "push", "pull", "sync", "clean"]) {
      const r = Constitution.classifyAstNode("fossil", sub, ["fossil", sub])
      expect(r.family).toBe("FOSSIL_MUTATE")
      expect(r.risk).toBe("DESTRUCTIVE")
      expect(r.hardBlock).toBe(true)
    }
    // Read-only fossil commands are not blocked
    for (const sub of ["timeline", "status", "diff", "ls", "info"]) {
      const r = Constitution.classifyAstNode("fossil", sub, ["fossil", sub])
      expect(r.family).toBe("ALLOWED")
    }
  })

  test("classifyAstNode: git commands classified correctly", () => {
    // Hard-block: checkout/switch/restore
    for (const sub of ["checkout", "switch", "restore"]) {
      const r = Constitution.classifyAstNode("git", sub, ["git", sub])
      expect(r.family).toBe("GIT_HISTORY_REWRITE")
      expect(r.hardBlock).toBe(true)
    }
    // reset without --hard is allowed
    const softReset = Constitution.classifyAstNode("git", "reset", ["git", "reset"])
    expect(softReset.family).toBe("ALLOWED")
    // reset --hard is blocked
    const hardReset = Constitution.classifyAstNode("git", "reset", ["git", "reset", "--hard"])
    expect(hardReset.family).toBe("GIT_HISTORY_REWRITE")
    // stash push is allowed, stash pop is blocked
    const stashPush = Constitution.classifyAstNode("git", "stash", ["git", "stash", "push"])
    expect(stashPush.family).toBe("ALLOWED")
    const stashPop = Constitution.classifyAstNode("git", "stash", ["git", "stash", "pop"])
    expect(stashPop.family).toBe("GIT_HISTORY_REWRITE")
    // force-push is askable destructive
    const forcePush = Constitution.classifyAstNode("git", "push", ["git", "push", "--force"])
    expect(forcePush.family).toBe("GIT_ASKABLE_DESTRUCTIVE")
    expect(forcePush.hardBlock).toBe(false)
    // clean -f is askable destructive
    const cleanF = Constitution.classifyAstNode("git", "clean", ["git", "clean", "-f"])
    expect(cleanF.family).toBe("GIT_ASKABLE_DESTRUCTIVE")
  })

  test("classifyAstNode: FALSE POSITIVE — git commit with 'fossil clean' in message is NOT fossil mutate", () => {
    // Regression: the old regex matched \bfossil\s+clean\b inside commit messages.
    // AST-based classification correctly sees cmd=git, sub=commit.
    // git commit is ELEVATED_GENERAL (not FOSSIL_MUTATE, not blocked).
    const r = Constitution.classifyAstNode("git", "commit", ["git", "commit", "-m", "fix(fossil): Phase 1"])
    expect(r.family).not.toBe("FOSSIL_MUTATE")
    expect(r.family).not.toBe("GIT_HISTORY_REWRITE")
    expect(r.hardBlock).toBe(false)
    // git commit is an elevated operation (logged, not blocked)
    expect(r.risk).toBe("ELEVATED")
  })

  test("classifyAstNode: git commit with 'git reset --hard' in message is NOT git rewrite", () => {
    // The commit message contains "git reset --hard" but the actual command is git commit.
    // Should NOT be classified as GIT_HISTORY_REWRITE.
    const r = Constitution.classifyAstNode("git", "commit", ["git", "commit", "-m", "fix: git reset --hard edge case"])
    expect(r.family).not.toBe("GIT_HISTORY_REWRITE")
  })

  test("classifyAstNode: file destructive commands", () => {
    const rmrf = Constitution.classifyAstNode("rm", undefined, ["rm", "-rf", "/tmp/x"])
    expect(rmrf.family).toBe("FILE_DESTRUCTIVE")
    expect(rmrf.hardBlock).toBe(false)
    expect(rmrf.permission).toBe("destructive-file")

    const rmSafe = Constitution.classifyAstNode("rm", undefined, ["rm", "file.txt"])
    expect(rmSafe.family).toBe("ALLOWED") // rm without -rf is not destructive by our rules
  })

  test("classifyAstNode: elevated commands", () => {
    const gitPush = Constitution.classifyAstNode("git", "push", ["git", "push"])
    expect(gitPush.family).toBe("ELEVATED_GENERAL")
    expect(gitPush.risk).toBe("ELEVATED")

    const npmPublish = Constitution.classifyAstNode("npm", "publish", ["npm", "publish"])
    expect(npmPublish.family).toBe("ELEVATED_GENERAL")
  })

  test("guardCommand: blocks fossil, returns correct messages (legacy path)", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      const g = Constitution.guardCommand("fossil commit -m test")
      expect(g.blocked).toBe(true)
      expect(g.message).toMatch(/fossil|auto-snapshot|git/i)
      expect(g.family).toBe("FOSSIL_MUTATE")
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("guardCommand: FALSE POSITIVE — git commit with fossil in message is NOT blocked", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      const g = Constitution.guardCommand("git commit -m \"fix(fossil): fossil clean --force replaced\"")
      expect(g.blocked).toBe(false)
      // Note: guardCommand uses token extraction (legacy), which correctly
      // identifies cmd=git sub=commit → not fossil. This was the original bug.
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })
})
