# Commit Audit Remediation — 2026-08-04 → 2026-08-05

**Date:** 2026-08-05  
**Status:** Superseded for **execution** by master + sub-plans (this file remains audit trail)  
**Execution plans:**  
- Master: `plans/2026-08-05_master_critical_remediation.md`  
- SP-01: `plans/2026-08-05_sp01_write_metadata_types.md`  
- SP-02: `plans/2026-08-05_sp02_fossil_layer_safety.md`  
- SP-03: `plans/2026-08-05_sp03_session_undo_semantics.md`  
- SP-04: `plans/2026-08-05_sp04_docs_and_defence.md`  
- SP-05: `plans/2026-08-05_sp05_phase3_atomic_integration.md`  
**Scope:** Last ~24h commits on `Local_Development` (`68830007db` … `e196d90949`)  
**Severity mix:** CRITICAL (fossil Phase 2), HIGH (write type + BUG-2 residual), MEDIUM (docs drift), LOW (dead code)

---

## 1. Commit inventory (grouped)

| Theme | Commits | Verdict |
|-------|---------|---------|
| **Permissions / agents** | `68830007` planexit+picker, `118ac91` codegraph*, `480da211` cross-ruleset, `fe878f79` wildcard | ✅ Looks correct; tests added for wildcard |
| **Binary isolation** | `3bb1895e` | ✅ Mode-invalidation of cached tools + isolation guard |
| **JSON repair** | `effd9df5` remove anyrepair → json-repair-wasm + tree-sitter | ✅ Intentional; docs in `plans_completed` still mention anyrepair (historical OK) |
| **Fossil grep docs** | `e665151f`, `a7af78b9` | ✅ Doc-only clarity (Fossil ≠ VCS) |
| **TUI git reminder** | `903bb303` | ✅ Low-risk UX |
| **cmd-runner skill** | `51ad8d47` ls/dir → list/glob | ✅ Aligns with constitution |
| **joboutput pattern** | `5a0a27c4`, `7d87d5f9` | ✅ Feature + tests; **docs lag** (`job_output.ts` path) |
| **Tool-call defence** | `def84213`, `c6d44976`, `0e9700f3` (+ type fixes `91cdd625`, `6e184120`) | ✅ 3-layer defence; gateway dead retry-budget removed cleanly |
| **Constitution AST** | `a291dc95`, `e196d909` | ✅ TreeSitter classification; AGENTS.md still accurate at policy level |
| **Fossil Phase 1** | `eb3b6a3e`, `e6ec87d4` | ⚠️ Partial — critical bleed stopped; architecture bugs remain |

---

## 2. Findings (errors / inconsistencies)

### F1 [CRITICAL] Fossil undo still architecturally broken (Phase 2 not done)

**Evidence:** `packages/opencode/src/session/revert.ts:131-133`

```ts
rev.snapshot = session.revert?.snapshot ?? (yield* snap.checkpoint())
rev.op_id = session.revert?.op_id ?? rev.snapshot
if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
```

This is **BUG-3**: second undo reuses stale snapshot and restores the wrong tree. Plan documents it; Phase 1 intentionally left it.

**Still open from plan:** BUG-3, BUG-4 (per-file revert), BUG-8 (cleanup aggregate patches), BUG-10 (atomicity).

**Do not move** `plans/fossil-undo-redo-fix.md` → `plans_completed/`.

---

### F2 [HIGH] BUG-2 residual — scoped cleanup still deletes all non-dot extras

**Plan recommended:** only delete extras that were *previously tracked* by Fossil.

**Implemented** (`fossil.ts` opRestore/restore): delete every `fossil extras` line except dotfiles.

```
fossil extras → for each non-dot path → fs.remove
```

User-created untracked files that are **not** in ignore-glob are still deleted on unrevert/restore. Ignore-glob protects `.gitignore` entries only.

**Fix direction:** before remove, require evidence of prior tracking (`fossil finfo` / timeline for path), or maintain an explicit agent-created file set per session.

---

### F3 [HIGH] BUG-9 incomplete — invalid hash is silent no-op

Plan: `Effect.fail` on missing checkout hash.  
Code: `log.error` + `return` (unrevert appears to succeed; tree unchanged).

Same pattern in both `opRestore` and `restore`.

---

### F4 [HIGH] Uncommitted `write.ts` — type error from syntax-reject path

**Committed HEAD fails typecheck:**

```
src/tool/write.ts(31,3): error TS2345
metadata.diagnostics: Record<...> not assignable to undefined
```

Cause: early return on syntax reject returns `{ filepath, exists }` while success path returns full `{ diagnostics, filediff, ... }`. Inference collapses metadata to the reject shape.

**WIP fix** uses `as any` (masks, does not fix).

**Proper fix:**

```ts
type WriteMeta = {
  filepath: string
  exists: boolean
  diagnostics: Record<string, LSP.Diagnostic[]>  // or import type
  filediff?: Snapshot.FileDiff
}

// reject path:
metadata: { filepath, exists, diagnostics: {}, filediff: undefined }
// success path: real diagnostics + filediff
```

Align with `edit.ts` which always provides `diagnostics` + `filediff`.

---

### F5 [MEDIUM] Docs drift (code/docs mismatch)

| Doc | Issue | Fix |
|-----|-------|-----|
| `docs/background-jobs.md:213` | Still lists `tool/job_output.ts` | → `tool/joboutput.ts` (+ note `pattern` param) |
| `plans/fossil-undo-redo-fix.md` SMOKE typecheck line | Claims 20 errors in write/deepseek/transform | Deepseek/transform fixed in later commits; write still broken on HEAD |
| `AGENTS.md` Fossil section | Mentions Phase-1 behaviors partially | After Phase 2, sync undo semantics |
| Completed plans mentioning `anyrepair` / `job_output.ts` | Historical | Leave in `plans_completed/` (archive) |

No active plan other than fossil was incomplete enough to “complete”.  
`plans/abstract_futures/` is graveyard — do not implement or move as completed work.

---

### F6 [MEDIUM] Dead / retained code smell

| Item | Location | Note |
|------|----------|------|
| `getEarliestCommit` | `fossil.ts` | Unused after BUG-1; comment says “retained” — delete or wire recovery |
| Gateway `retry-budget` | deleted | OK if no callers (verified removed from store) |
| `as any` on disguised-tool error | `processor.ts` | Cast on `assistantMessage.error` — prefer typed error union |

---

### F7 [LOW] Syntax validator coverage gaps

`syntax-validator.ts` only: `.py .ts .tsx .js .jsx .sh .bash`.  
No `.json`, `.rs`, `.go`, `.zig`, `.md` — intentional soft-fail is fine, but document “best-effort” in tool description if models rely on REJECTED.

Silent `catch` on grammar load returns null (skip) — acceptable soft-fail; log at debug once?

---

### F8 [LOW] Inline tool-call detector false positives

`extractInlineToolCalls` regex can match prose like `config{...}` in explanations. Level-2 only runs on `finish_reason === "stop"` with text ≥ 10 chars — still risk of retry loops. Consider allowlist of known tool ids from registry.

---

## 3. What was done well (no action)

1. **Permission wildcard + cross-ruleset** — real product bugs fixed with tests.  
2. **anyrepair removal** — simpler repair path; tests for JSON policy.  
3. **DeepSeek 3-layer defence** — DSML normalize, disguised detect, pre-write syntax.  
4. **Fossil Phase 1** — no more silent revert-to-empty; backup before reinit; revert commit failures logged; rollback test fixed.  
5. **Constitution TreeSitter** — less brittle than regex classification.  
6. **joboutput pattern** — good agent UX for large job logs.

---

## 4. Plan status hygiene

| Plan | Action |
|------|--------|
| `plans/fossil-undo-redo-fix.md` | **Keep active** — Phase 1 ✅ / 2–3 pending. Update status matrix to show done vs pending columns (currently “Must Fix ✅” confuses with “Done”). |
| `plans/abstract_futures/*` | **No touch** (graveyard). |
| Other `plans/*` | Only fossil file present — nothing to move to `plans_completed/`. |
| This plan | Track remediation below; move when all P0–P1 items closed. |

### Suggested status patch for fossil plan (editorial)

Add explicit columns:

| Bug | Phase | Status |
|-----|-------|--------|
| BUG-1,2*,5,6,7,9* | 1 | Done (* = residual noted F2/F3) |
| BUG-3,4,8 | 2 | Pending |
| BUG-10 + tests | 3 | Pending |

---

## 5. Remediation work breakdown

### P0 — Stop typecheck / ship hygiene (same day)

| ID | Task | Files | Smoke |
|----|------|-------|-------|
| P0.1 | Fix write metadata typing without `as any` | `tool/write.ts` | `bun typecheck` clean in `packages/opencode` |
| P0.2 | Commit or discard WIP write.ts after P0.1 | git | `git status` clean for intentional changes |

### P1 — Fossil correctness (next session)

| ID | Task | Bugs | Smoke |
|----|------|------|-------|
| P1.1 | Fresh `checkpoint()` always for `rev.snapshot`; restore only when undoing further back | BUG-3 | multi-undo unit/integration test |
| P1.2 | Session undo → full checkout to target hash (not per-file mix) | BUG-4 | fossil-rollback + session revert tests |
| P1.3 | Per-step patches in cleanup or document aggregate as recovery-only | BUG-8 | processor cleanup path test |
| P1.4 | BUG-2 residual: track-aware extras delete | BUG-2 residual | untracked user file survives unrevert |
| P1.5 | BUG-9: fail hard / surface error to TUI on bad hash | BUG-9 | unrevert with invalid op_id errors clearly |

### P2 — Docs + hardening

| ID | Task |
|----|------|
| P2.1 | Update `docs/background-jobs.md` paths + `pattern` API |
| P2.2 | Stamp fossil plan SMOKE.AFTER with current typecheck (post P0.1) |
| P2.3 | Remove or use `getEarliestCommit` |
| P2.4 | Tool-id allowlist for disguised tool-call detector |
| P2.5 | Optional: debug-log when syntax grammar skip |

### P3 — Phase 3 fossil (later)

| ID | Task |
|----|------|
| P3.1 | Atomic revert (stash / all-or-nothing) BUG-10 |
| P3.2 | Session DB “history lost” marker after reinit |
| P3.3 | Integration suite: 100-step undo, triple undo, conflict .bak |

---

## 6. Smoke Tests

### SMOKE.BEFORE (record before edits)

```
cwd: packages/opencode
bun typecheck
# Expected HEAD (without WIP as any): FAIL write.ts metadata
# With current WIP as any: PASS (mask)

bun test test/snapshot/
# Phase 1 baseline: fossil 14 pass; rollback 5 pass 2 skip; track/lifecycle pass

bun test test/util/dsml-normalizer.test.ts test/util/syntax-validator.test.ts
# Expect pass after defence commits
```

### POST_IMPL oracles

| Gate | Pass criteria |
|------|---------------|
| P0.1 | `bun typecheck` 0 errors; no `as any` on write metadata |
| P1.* | New/updated tests green; no silent empty-tree restore on invalid hash |
| P2.1 | Doc paths resolve to existing files |

`smoke: N/A` does **not** apply — code + docs changes.

---

## 7. Discussion points (for human decision)

1. **Phase 2 fossil risk:** full checkout (BUG-4) can clobber user manual edits — need .bak restore protocol before switching models.  
2. **BUG-2 residual:** is deleting all non-dot extras acceptable if ignore-glob is complete, or do we require track-evidence?  
3. **write reject UX:** return soft REJECTED (current) vs throw (force model tool retry like JSON)? Soft is better for syntax.  
4. **Disguised tool-call false positives:** allowlist vs broader regex — product call.  
5. **Priority order:** P0.1 first (unblocks clean typecheck on mainline), then fossil P1 before more features.

---

## 8. Prior art

- `plans/fossil-undo-redo-fix.md` — authoritative fossil bug catalog  
- Commits listed in §1  
- `docs/background-jobs.md` — needs path update only  
- REUSE: no new libraries; extend existing snapshot/session paths

---

## 9. Checklist

- [ ] P0.1 write metadata types  
- [ ] P0.2 clean git state  
- [ ] P1.1 BUG-3 second undo  
- [ ] P1.2 BUG-4 full checkout undo  
- [ ] P1.3 BUG-8 cleanup patches  
- [ ] P1.4 BUG-2 residual  
- [ ] P1.5 BUG-9 hard fail  
- [ ] P2.1–P2.5 docs/hardening  
- [ ] P3.* when Phase 2 stable  
- [ ] Update fossil plan status matrix; keep in `plans/` until Phase 3 done  
- [ ] Move **this** plan to `plans_completed/` when P0–P1 closed and smoke stamped  
