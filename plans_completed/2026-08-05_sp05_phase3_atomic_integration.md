# SP-05: Phase 3 — Atomic Revert, History-Lost Marker, Integration Suite

**Parent:** `plans/2026-08-05_master_critical_remediation.md`  
**Date:** 2026-08-05  
**Status:** Implemented 2026-08-05 — HISTORY_INVALID + atomic preserve rollback + soft patch hash warn
**Severity:** MEDIUM→HIGH for long sessions  
**Risk:** Medium  
**Depends on:** SP-03  
**Maps bugs:** BUG-10, Phase 3 items from fossil plan

---

## 1. Goals

1. **Atomicity (BUG-10):** undo either fully applies or rolls back — no partial file tree.  
2. **History-lost marker:** after destructive fossil reinit (even with backup), sessions know hashes are invalid.  
3. **Integration suite:** multi-step, multi-undo, stress, unskip skipped fossil tests where safe.  
4. **Hash validation at write:** when patch parts are stored, optionally verify hash still exists (soft warn).

---

## 2. Prior art

- Fossil `stash` (if available in bundled fossil 2.28) — research required  
- Alternative: commit pre-undo leaf tag `pre-revert-<op>` then checkout target; on failure `update` back to tag  
- Phase 1 backup path: `snapshot.fsl.bak.<timestamp>`  
- Skipped tests: `fossil-rollback.test.ts` `update rolls back…`, `multiple rollbacks…`  

---

## 3. Implementation design

### 3.1 Atomic revertTo

**Algorithm:**

```
1. pre = checkpoint()
2. tag or record pre hash
3. try:
     checkout target
     cleanupExtrasTracked
     preserveFiles from bak
     commit session-revert
4. catch:
     checkout/restore pre
     rethrow
```

If Fossil stash is reliable on Windows, stash is OK; else **pre-hash + restore** is enough (we already have restore).

**Test:** inject failure mid-path (e.g. invalid preserve path after successful checkout mock is forbidden — instead use readonly file lock or deliberately fail commit and ensure tree returns to pre).

Prefer: force commit failure (empty commit) and assert tree still matches target or pre per policy — define policy:

- **Preferred policy:** if checkout succeeded but commit failed, tree may be correct at target (Phase 1 logged). Atomicity focuses on **failed checkout mid-way**. With single checkout command, atomicity is mostly “validate before mutate”.  
- **Real partial risk:** preserveFiles loop + extras deletes. Wrap: if preserve fails, restore `pre`.

### 3.2 History-lost marker

On reinit after corruption (backup path in ensureInit):

```ts
// write marker file next to repo
// {data}/fossil/{projectID}/HISTORY_INVALID.json
{ "at": iso, "backupPath": "...", "reason": "reinit" }
```

`resolveHash` / `validateHash`: if marker present, fail with message pointing to backup.

Session DB optional flag — marker file is enough if checked on every fossil op.

Clear marker only on explicit user recovery command (out of scope) or successful full re-baseline documented later.

### 3.3 Validate hash when writing patch parts

In processor finish-step after track:

```ts
// optional: fossil info hash; log.warn if missing
```

Do not block agent loop hard unless configured — soft warn first.

### 3.4 Integration suite

New: `test/session/session-undo-integration.test.ts` or extend SU suite from SP-03.

| Test | Detail |
|------|--------|
| INT-1 | 10 sequential edits, undo to step 3, unrevert |
| INT-2 | 3-level further-back undo |
| INT-3 | undo → new agent edit → undo again (dirty redo path) |
| INT-4 | history marker blocks undo with clear error |
| INT-5 | unskip multi-rollback if update path stable |

### 3.5 Unskip fossil-rollback tests

Investigate skip reasons; fix or replace with `revertTo`-based tests. Do not unskip if flaky on CI without root cause.

---

## 4. Smoke Tests

### SMOKE.BEFORE

```
# Only after SP-03 G3
bun test test/session/session-undo-fossil.test.ts
bun test test/snapshot/
```

### POST_IMPL

| # | Oracle | Pass |
|---|--------|------|
| P3.1 | atomic failure restores pre | Exact content |
| P3.2 | HISTORY_INVALID blocks resolveHash | fail message contains backup |
| P3.3 | INT-1…INT-4 | pass |
| P3.4 | full snapshot + session suites | 0 fail |
| P3.5 | typecheck | 0 |

---

## 5. Real tests

All real fossil + tmp worktree. No mocks.

| ID | Assert |
|----|--------|
| AT-1 | simulate preserveFiles failure → tree == pre |
| AT-2 | marker present → revertTo fails clear |
| AT-3 | INT-* |

---

## 6. Checklist

- [x] SP-03 G3 confirmed  
- [x] Atomic policy: pre-leaf hash; rollback on preserveFiles failure  
- [x] HISTORY_INVALID marker after reinit + assert on resolve/checkout  
- [x] Tests: HISTORY_INVALID blocks restore; structure still pass  
- [x] Soft-warn weak patch hash in processor  
- [ ] Unskip fossil-rollback multi-update (deferred — update path flaky)  
- [x] Master G5 + move completed sub-plans to plans_completed

---

## Exit criteria

Master G5. Commit suggestion:

`fix(snapshot): atomic revertTo + history-invalid marker + integration tests`
