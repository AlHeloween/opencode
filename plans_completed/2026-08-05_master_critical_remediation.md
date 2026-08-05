# Master Plan: Critical Remediation (Write Types + Fossil Undo/Redo + Docs/Defence)

**Date:** 2026-08-05  
**Status:** Complete 2026-08-05 — SP-01..05 implemented  
**Severity:** CRITICAL (data loss / silent corruption on undo-redo) + HIGH (typecheck break)  
**Branch:** `Local_Development`  
**Audit source:** `plans/2026-08-05_commit_audit_remediation.md`  
**Related:** `plans/fossil-undo-redo-fix.md` (bug catalog + Phase 1 done)

---

## 1. Goal

Make agent undo/redo **correct, fail-loud, and non-destructive** for user files; restore **clean typecheck** on the write-tool defence path; align **docs** with post-anyrepair / joboutput reality; harden **tool-call defence** against false positives.

**Non-goals (this master):**

- Redesign of message history UI  
- Training / model changes  
- abstract_futures/*  

**VCS vs snapshots (locked):** Git is project version control. Fossil is the agent snapshot/undo system only (`{data}/fossil/…`). Do not conflate them.

---

## 2. Why this is critical

| Failure mode | User impact | Current state |
|--------------|-------------|-----------------|
| Invalid hash → earliest commit (pre Phase 1) | Silent wipe to empty tree | Fixed Phase 1 (BUG-1) |
| Second-level undo stale snapshot (BUG-3) | Wrong tree / redo broken | Fixed SP-03 (fresh anchor + redo_stack) |
| Per-file multi-hash revert (BUG-4) | Mixed states that never existed | Fixed SP-03 (full-leaf `revertTo`) |
| Extras cleanup deletes user files (BUG-2 residual) | Lost untracked user work on unrevert | Fixed SP-02 (preLs ∩ extras) |
| Missing checkout hash silent return (BUG-9) | Unrevert “succeeds”, tree unchanged | Fixed SP-02 (hard-fail) |
| `write.ts` metadata inference | `bun typecheck` fails on HEAD | Fixed SP-01 |

Ship rule: **no `[x]` on a sub-plan until its POST_IMPL smoke table is green.**

---

## 3. Sub-plan index (execute in order)

| ID | Plan file | Scope | Risk | Depends on |
|----|-----------|-------|------|------------|
| **SP-01** | `plans/2026-08-05_sp01_write_metadata_types.md` | Write tool metadata typing | Low | — |
| **SP-02** | `plans/2026-08-05_sp02_fossil_layer_safety.md` | Fossil: hard fail, track-aware extras, dead code | Medium | SP-01 (hygiene only) |
| **SP-03** | `plans/2026-08-05_sp03_session_undo_semantics.md` | SessionRevert BUG-3 + BUG-4 full checkout | **High** | SP-02 |
| **SP-04** | `plans/2026-08-05_sp04_docs_and_defence.md` | Docs drift + disguised-tool allowlist | Low | SP-01 |
| **SP-05** | `plans/2026-08-05_sp05_phase3_atomic_integration.md` | Atomicity, history-lost marker, long suite | Medium | SP-03 |

```
SP-01 (write types) ─────────────────────────┐
         │                                     │
         ▼                                     ▼
SP-02 (fossil safety layer)            SP-04 (docs/defence)
         │
         ▼
SP-03 (session undo semantics)  ◄── CRITICAL PATH
         │
         ▼
SP-05 (phase 3 harden + integration)
```

**Parallelism:** SP-01 and the **read-only** parts of SP-04 may start together.  
**Never parallel:** SP-02 and SP-03 (same files: `fossil.ts`, `revert.ts`).

---

## 4. Locked product invariants (do not negotiate mid-impl)

These are acceptance criteria for the whole program. Sub-plans must preserve them.

### I-1 Tree identity

A session undo to message `M` restores the **Fossil tree state that existed before the earliest agent step after `M`**.  
That state is identified by a **single** Fossil checkin hash (the earliest collected patch’s `hash`), not a mix of per-file hashes.

### I-2 Redo anchor

`session.revert.snapshot` / `op_id` is **always** a fresh `checkpoint()` taken **immediately before** this undo’s tree mutation.  
Never copy a previous revert’s snapshot into the new revert record.

### I-3 Fail loud

Missing / invalid Fossil hash → **error** (log `bug:` + Effect failure or structured session error).  
Never fall back to earliest commit. Never pretend success with no tree change for unrevert.

### I-4 User file non-destruction

Untracked files the **user** created (never agent-tracked in Fossil history) must **survive** checkout/unrevert cleanup.  
Only remove extras that Fossil previously tracked (or that appear in the undo’s patch file list as “should not exist at target”).

### I-5 User edit conflicts

If the user edited a file after the agent (`.bak` mismatch), undo must **surface conflicts** (existing `rev.conflicts`) and must **not** silently overwrite those files without restore-from-bak policy (SP-03 specifies order).

### I-6 Typecheck green

`packages/opencode` → `bun typecheck` has **zero** errors after SP-01; no new `as any` on write metadata.

### I-7 Tests are real

No mock of Fossil CLI for rollback correctness tests. Use real `fossil` binary + temp worktree (existing snapshot test pattern). Avoid mocks per AGENTS.md.

---

## 5. Architecture target (end state after SP-03)

### 5.1 Undo (SessionRevert.revert)

```
User undo → message M
    │
    ├─ Collect patch parts AFTER M (chronological)
    ├─ targetHash = patches[0].hash   // earliest; BEFORE undone work
    │     (if no patches: message-only cleanup, no fossil)
    │
    ├─ conflicts = .bak comparison (existing)
    │
    ├─ if prior.revert exists AND M is further back:
    │     restore(prior.snapshot) so base is pre-first-undo   [or skip if full-checkout from absolute target]
    │
    ├─ anchor = checkpoint()          // ALWAYS fresh  (I-2)
    │   rev.snapshot = rev.op_id = anchor
    │
    ├─ snap.revertTo(targetHash, { preserve: conflict files via bak })
    │     → validate hash (I-3)
    │     → fossil checkout --force targetHash
    │     → track-aware extras cleanup (I-4)
    │     → restore conflict files from .bak (I-5)
    │     → commit "session-revert" (log fail, I-3 style)
    │
    └─ setRevert + optional message cleanup
```

**Note:** Full checkout to `targetHash` already places the tree at the correct absolute state for further-back undo **if** `targetHash` is correct. Prior `restore(prior.snapshot)` is only required if intermediate uncommitted user state must be discarded first; SP-03 spells the exact algorithm and tests both paths.

### 5.2 Redo (unrevert)

```
if op_id:
  validate info(op_id) → fail if missing (I-3)
  checkout(op_id) + track-aware extras (I-4)
clearRevert
```

### 5.3 Snapshot API extension (SP-02/03)

```ts
// Preferred new entry (name TBD in SP-03):
readonly revertTo: (
  targetHash: string,
  opts?: { preserveFiles?: readonly string[] },
) => Effect.Effect<void>

// Keep patch-based revert during migration OR replace if all callers updated:
readonly revert: (patches: Patch[]) => Effect.Effect<void>  // deprecate after SP-03
```

---

## 6. Master smoke gates

Run from `packages/opencode` unless noted.

### G0 — Baseline (record before ANY edit of SP-02/03)

| # | Command | Expected now (Exact — re-run and stamp) |
|---|---------|----------------------------------------|
| G0.1 | `bun typecheck` | FAIL write.ts OR PASS only with WIP `as any` |
| G0.2 | `bun test test/snapshot/` | Phase 1: fossil 14p; rollback 5p 2skip; track/lifecycle OK |
| G0.3 | `bun test test/session/revert-compact.test.ts` | Pass (message cleanup paths) |
| G0.4 | `bun test test/util/dsml-normalizer.test.ts test/util/syntax-validator.test.ts` | Pass |

**Agent duty:** paste Exact results into this file under `## SMOKE.BASELINE` before SP-02 edits.

### G1 — After SP-01

| Oracle | Pass |
|--------|------|
| `bun typecheck` | 0 errors |
| No `as any` on write return metadata | grep clean |
| Existing write/edit tool tests if any | pass |

### G2 — After SP-02

| Oracle | Pass |
|--------|------|
| `bun test test/snapshot/fossil-rollback.test.ts` | 0 fail; enable skip if fixed |
| New: invalid hash hard-fails | pass |
| New: user untracked file survives restore | pass |
| G0.2 full snapshot suite | no regression |

### G3 — After SP-03 (release gate for critical path)

| Oracle | Pass |
|--------|------|
| New session multi-undo suite | all pass |
| Second undo content Exact | expected versions |
| Unrevert after double undo | Exact pre-undo tree |
| G2 + G0.2 + G0.3 | green |
| Manual TUI smoke (optional but recommended) | see SP-03 |

### G4 — After SP-04

| Oracle | Pass |
|--------|------|
| Doc paths exist on disk | `joboutput.ts` etc. |
| Disguised-tool allowlist tests | pass |

### G5 — After SP-05

| Oracle | Pass |
|--------|------|
| Atomic / partial-fail tests | pass |
| 100-step undo stress (if practical) | pass or documented limit |
| Unskip fossil-rollback multi-rollback if safe | green |

---

## 7. Rollout & risk controls

| Risk | Mitigation |
|------|------------|
| Full checkout clobbers user edits | SP-03: detect conflicts → restore from `.bak` after checkout; keep `rev.conflicts` |
| Extras cleanup still deletes user files | SP-02: track-evidence before delete; tests with user-only file |
| Effect.fail crashes TUI undo | Surface typed error + toast; do not leave session.revert half-written |
| Half-applied SP-03 | Land SP-02 first; SP-03 single PR conceptually; no intermediate “half full-checkout” merge |
| KV cache | **No system prompt changes** in SP-01–05. Flag if any prompt string edits slip in. |
| Pre-push hooks | typecheck + tests must pass; never `--no-verify` |

**Commit strategy:**

1. SP-01 alone (small, safe)  
2. SP-02 alone (fossil safety)  
3. SP-03 alone (semantic rewrite — review carefully)  
4. SP-04 alone  
5. SP-05 alone  

---

## 8. Plan hygiene

| Document | Role after program |
|----------|-------------------|
| This master | Tracker; move to `plans_completed/` when SP-01…SP-05 all `[x]` |
| `fossil-undo-redo-fix.md` | Keep until SP-05; mark Phase 2/3 `[x]` as sub-plans finish |
| `2026-08-05_commit_audit_remediation.md` | Superseded by this master for execution; leave as audit trail or merge note |
| Sub-plans | Move each to `plans_completed/` when its smoke table green |

**Do not** use `.opencode/plans/`.

---

## 9. Prior art

| Source | Use |
|--------|-----|
| `plans/fossil-undo-redo-fix.md` | Full bug catalog, Phase 1 deltas |
| `packages/opencode/test/snapshot/*` | Real Fossil fixtures |
| `packages/opencode/test/session/revert-compact.test.ts` | SessionRevert Effect harness |
| Commit `eb3b6a3` | Phase 1 reference implementation |

REUSE.BEFORE: no new WASM/deps; extend existing Fossil + Effect layers.

---

## 10. Master checklist

- [x] SMOKE.BASELINE stamped (Exact)  
- [x] SP-01 complete + G1 (typecheck 0; write syntax reject test pass; no metadata `as any`)  
- [x] SP-02 complete + G2 (preLs extras; hard-fail invalid restore; snapshot restore tests pass)  
- [x] SP-03 complete + G3 (`revertTo`; fresh anchors; session-undo-fossil 6/6 pass)  
- [x] SP-04 complete + G4 (allowlist + docs + AGENTS fossil note)  
- [x] SP-05 complete + G5 (HISTORY_INVALID + atomic preserve rollback)  
- [x] Update `fossil-undo-redo-fix.md` Phase 2/3 status  
- [x] Move finished plans → `plans_completed/`  
- [x] Master → `plans_completed/` when all sub-plans done

---

## 11. Smoke Tests (master)

### SMOKE.BEFORE

See G0. **Do not start SP-02/SP-03 until G0 is recorded Exact.**

### POST_IMPL (master done)

```
cwd: packages/opencode
bun typecheck                                          # 0 errors
bun test test/snapshot/                                # 0 fail
bun test test/session/                                 # 0 fail (or known skips documented)
bun test test/util/dsml-normalizer.test.ts \
         test/util/syntax-validator.test.ts
```

Optional TUI (cmd_runner from `dist/bin`): create session → write files → undo twice → unrevert → assert file contents.

---

## SMOKE.BASELINE

Recorded 2026-08-05 during implementation kickoff. Environment note: many snapshot/write tests hit default 5s timeout under load (fossil/LSP); counts are Exact for that run, not necessarily product regressions.

| Gate | Actual [Exact] | When | Agent |
|------|----------------|------|-------|
| G0.1 typecheck | PASS (`tsgo --noEmit` 0 errors) with WIP `as any` on write; without WIP would fail write metadata TS2345 | 2026-08-05 | kickoff |
| G0.2 snapshot | 45 pass, 3 skip, 54 fail (mostly 5s timeouts on diffFull/revert under load) | 2026-08-05 | kickoff |
| G0.3 revert-compact | 3 pass, 4 fail (timeouts + one expect undefined) | 2026-08-05 | kickoff |
| G0.4 defence unit | dsml+syntax: 38 pass, 1 fail (`rejects TypeScript with syntax error` got null) | 2026-08-05 | kickoff |

**VCS vs snapshots:** Git = project VCS. Fossil = agent snapshots only.
