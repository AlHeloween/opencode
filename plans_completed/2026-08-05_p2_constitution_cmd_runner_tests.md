# P2: Automate cmd_runner send Constitution Policy Tests

**Parent:** `plans/2026-08-05_master_post_remediation.md`  
**Priority:** P0  
**Risk:** Low  
**Status:** Done  

---

## 1. Goal

Lock the policy in **code tests** (not only docs):

| Context | `ls`/`dir` | `rm -rf` / git checkout / fossil mutate |
|---------|------------|------------------------------------------|
| Bare shell | hard-block enumeration | permission ask |
| After `cmd_runner send … --` | **not** hard-block | permission ask |

Covers **SSH remote** and **interactive TUI debug** (same split).

---

## 2. Prior art

- `splitCmdRunnerSend`, `enforceBrutalDestructiveOnly` — `shell-constitution.ts`  
- `guardBrutalDestructive` — `constitution.ts`  
- Existing: `guardBrutalDestructive: ls/dir not gated…` unit test  
- AGENTS.md Shell restrictions  

---

## 3. Implementation

1. **Unit — split**  
   - `splitCmdRunnerSend("cmd_runner send rid -- ls -la")` → payload `ls -la`, shellScan ends with `--`  
   - no `--` → payload undefined  

2. **Unit — guardBrutalDestructive** (extend if needed)  
   - `ls`, `dir`, `find` → no ask, not blocked  
   - `rm -rf`, `git checkout`, `fossil commit` → needsDestructivePermission  

3. **Unit — enforce path**  
   Prefer pure guards over mocking `ctx.ask`. Document that bash/cmd call split + brutal after AST.  

4. **AGENTS** already documents policy — verify no drift after code.  

Files:

| File | Change |
|------|--------|
| `test/session/constitution.test.ts` | existing brutal tests |
| `test/tool/shell-constitution.test.ts` | **expanded** — split + bare vs payload + ask |
| `src/tool/shell-constitution.ts` | export already present |

Also fixed kernel gate: `test_tool_descriptions_do_not_recommend_blocked_shell` false-positive on cmd-runner skill wording.

---

## 4. Smoke Tests

### SMOKE.BEFORE

```
cwd: packages/opencode
bun test test/session/constitution.test.ts
# Actual: 37 pass
```

### POST_IMPL

| # | Command | Pass |
|---|---------|------|
| C1 | `bun test test/session/constitution.test.ts` | 0 fail |
| C2 | `bun test test/tool/shell-constitution.test.ts` | 0 fail |
| C3 | `bun typecheck` | 0 |

### Real tests (mandatory)

| Test | Assert |
|------|--------|
| split extracts payload | Exact strings |
| payload ls/dir not blocked | `guardBrutalDestructive` / enforce no hard block |
| payload rm -rf needs ask | ask called |
| bare platform enum still blocked | `dir` (win) / `ls` (unix) |

---

## 5. Checklist

- [x] SMOKE.BEFORE  
- [x] split tests  
- [x] brutal vs bare enumeration tests  
- [x] C1–C3 green  
- [x] Master G2  

---

## Exit

Master G2. Commit: `test(constitution): lock cmd_runner send payload policy (SSH/TUI)`
