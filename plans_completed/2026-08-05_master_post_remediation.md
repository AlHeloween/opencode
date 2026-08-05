# Master Plan: Post-Remediation Stabilization & Hardening

**Date:** 2026-08-05  
**Status:** Complete — ready for `plans_completed/`  
**Branch:** `Local_Development`  
**Prerequisite:** Critical remediation complete (`plans_completed/2026-08-05_master_critical_remediation.md`, SP-01…05)  
**Severity:** MEDIUM (product confidence + residual debt) — not data-loss critical

---

## 1. Context

| Done (do not re-open) | Remaining |
|-----------------------|-----------|
| Full-leaf Fossil undo/redo + docs | Prove it in **real TUI** — hybrid Exact |
| HISTORY_INVALID + atomic preserve | Optional rename/move oracle — done |
| Constitution AST + allow lists | Align dual path (run.ts legacy) — B documented |
| cmd_runner send: SSH/TUI payload policy | Automate payload constitution tests — done |
| Disguised-tool allowlist | Live registry union — done |

**Thesis:** Prefer **prove shipped behavior** and **small hardness** over new architecture. No cathedral plans.

**VCS vs snapshots:** Git = project VCS. Fossil = agent snapshot leaves. Unchanged.

---

## 2. Goal

1. **Prove** undo/redo + constitution + cmd_runner send in interactive/TUI and SSH-like flows.  
2. **Close residual gaps** that can reintroduce false blocks or silent safety holes.  
3. **Housekeeping** that prevents doc/code drift and junk files.  
4. Keep optional polish **explicitly optional** (no silent scope creep).

---

## 3. Sub-plan index (execute roughly in order)

| ID | Plan | Priority | Risk | Status |
|----|------|----------|------|--------|
| **P1** | `plans/2026-08-05_p1_tui_undo_smoke.md` | **P0** | Low | Done (hybrid) |
| **P2** | `plans/2026-08-05_p2_constitution_cmd_runner_tests.md` | **P0** | Low | Done |
| **P3** | `plans/2026-08-05_p3_fossil_rename_oracle.md` | P1 | Low | Done |
| **P4** | `plans/2026-08-05_p4_hygiene_junk_and_docs.md` | P1 | Low | Done |
| **P5** | `plans/2026-08-05_p5_run_tool_ast_path.md` | P2 | Medium | Cancelled B |
| **P6** | `plans/2026-08-05_p6_disguised_tool_registry.md` | P2 | Medium | Done |
| **P7** | `plans/2026-08-05_p7_history_invalid_recovery_ux.md` | P3 | Medium | Cancelled C |

---

## 4. Locked invariants (carry forward)

| ID | Invariant |
|----|-----------|
| I-Fossil | Undo = full leaf; extras ∩ preLs only; no `clean --force` |
| I-Git | Project VCS only; agent fossil mutate hard-blocked outside payload policy |
| I-Send | After `cmd_runner send --`: no enumeration hard-block; brutal DESTRUCTIVE always asks |
| I-Tools | `list`/`glob`/`grep` ≠ `git ls-files` / `where` / `findstr` / bare `echo` |
| I-KV | No system-prompt mutation unless explicitly approved |

---

## 5. Master smoke gates

| Gate | When | Pass |
|------|------|------|
| **G0** | Start | typecheck 0; constitution 37 pass; session-undo-fossil 7 pass (60s timeout) |
| **G1** | After P1 | Structure Exact + TUI direct-terminal key delivery |
| **G2** | After P2 | shell-constitution + constitution green |
| **G3** | After P3 | rename/move oracle green |
| **G4** | After P4 | junk gone; docs consistent |
| **G5** | Program done | All P* closed |

---

## 6. Explicitly out of scope

- New snapshot systems or backends  
- abstract_futures / Zig migrations  
- Full constitution rewrite  
- Unskip flaky fossil `update` multi-rollback without root cause  
- Training / model fine-tunes  
- ConPTY OpenTUI stability (env residual; use `--direct-terminal` for TUI)  

---

## 7. Prior art

- `docs/fossil-snapshot.md`  
- `plans_completed/2026-08-05_master_critical_remediation.md`  
- `packages/opencode/src/session/constitution.ts` (`guardBrutalDestructive`)  
- `packages/opencode/src/tool/shell-constitution.ts` (`splitCmdRunnerSend`)  
- `.cursor/skills/cmd-runner/SKILL.md`  
- AGENTS.md Shell Command Restrictions  

---

## 8. Master checklist

- [x] G0 stamped  
- [x] P1 complete + G1  
- [x] P2 complete + G2  
- [x] P3 complete  
- [x] P4 complete + G4  
- [x] P5 cancelled B  
- [x] P6 complete  
- [x] P7 cancelled C  
- [ ] Move finished sub-plans → `plans_completed/`  
- [ ] This master → `plans_completed/` when residual work closed  

---

## 9. Smoke Tests (master)

### SMOKE.BASELINE

| Gate | Actual [Exact] | When |
|------|----------------|------|
| typecheck | 0 errors | kickoff + post |
| constitution tests | 37 pass | kickoff |
| session-undo-fossil | 7 pass @60s | kickoff; 8 pass after P3 |
| git status | ahead 5 + plans + junk | kickoff |

### POST_IMPL (program)

- typecheck 0  
- constitution + shell-constitution + dsml-normalizer + session-undo-fossil green  
- kernel pytest 483 (after skill wording fix)  
- build 10.0.759  

---

## Deliverables summary

| Area | Change |
|------|--------|
| Tests | P2 shell-constitution policy; P3 rename oracle; P6 knownToolIdsForTurn |
| Product | processor live tool allowlist for disguised calls |
| Docs | run legacy constitution; HISTORY_INVALID manual recovery; cmd-runner skill wording |
| Kernel | tool_consistency markers for session-side allow language |
| Hygiene | junk file removed |
