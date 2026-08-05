# SP-03: Session Undo Semantics (BUG-3 + BUG-4) — CRITICAL

**Parent:** `plans/2026-08-05_master_critical_remediation.md`  
**Date:** 2026-08-05  
**Status:** Implemented 2026-08-05 — full-leaf navigation + multi-level redo_stack; structure test h1/h2→h2'/h3→h4 both directions pass
**Severity:** CRITICAL  
**Risk:** High — changes core undo path  
**Depends on:** SP-02  
**Blocks:** SP-05; trustworthy agent undo  
**Maps bugs:** BUG-3, BUG-4, BUG-8 (cleanup path coordination)

---

## 1. Problem statement

### BUG-3 — Second-level undo / redo anchor

```ts
// packages/opencode/src/session/revert.ts (~131-134)
rev.snapshot = session.revert?.snapshot ?? (yield* snap.checkpoint())
rev.op_id = session.revert?.op_id ?? rev.snapshot
if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
yield* snap.revert(patches)
```

Defects:

1. **Stale anchor:** reuses prior `snapshot` as the new redo target instead of always capturing **current** tree before mutation.  
2. **Unconditional prior restore:** always restores prior snapshot when any prior revert exists, without distinguishing “further back” vs invalid double-apply.  
3. Combined with per-file revert, multi-undo produces non-existent trees.

### BUG-4 — Per-file multi-hash revert

```ts
// fossil.ts revert(patches)
for each patch, for each file not yet seen:
  fossil revert file -r resolveHash(patch.hash)
```

Different files can be restored to **different** historical trees → mixed state never committed as a unit.

### BUG-8 (coordination)

Processor `cleanup()` can emit one aggregate patch for multi-step failures. After full-checkout undo, incorrect patch hashes still poison future undos. SP-03 must either:

- **A)** document that cleanup aggregate is recovery-only and fix target selection to use earliest valid hash, and/or  
- **B)** emit better per-step patches (preferred if cheap).

Minimum for SP-03 exit: **session undo correctness when normal finish-step patches exist**. Cleanup path: explicit test + safe behavior (skip full checkout if hash invalid).

---

## 2. Target design (locked)

### 2.1 Single-hash undo

When undoing to message `M` with collected patches `P[]` (chronological):

```
targetHash = P[0].hash   // patch part stores hash BEFORE that step
```

If `P` empty → no fossil mutation; existing message cleanup only.

### 2.2 Fresh redo always

```
anchor = yield* snap.checkpoint()   // BEFORE tree mutation
// if checkpoint undefined (fossil down): fail loud, do not setRevert half-state
rev.snapshot = anchor
rev.op_id = anchor
```

### 2.3 Full tree restore

Replace per-file loop for **session undo** with:

```
snap.revertTo(targetHash, { preserveFiles: conflicts.map(c => c.file) })
```

Implementation inside fossil (SP-02 helpers):

1. `validateHash(targetHash)`  
2. `fossil checkout --force targetHash` (or `update` if research proves safer — see §4.1)  
3. `cleanupExtrasTracked()`  
4. For each `preserveFiles` path: copy latest `.bak` over file if bak exists  
5. `fossil commit -m "session-revert" --no-warnings --allow-fork` (log fail if dirty; do not silent swallow without log — Phase 1 BUG-6)

### 2.4 Further-back undo

With full checkout to absolute `targetHash`, intermediate `restore(prior.snapshot)` is **usually unnecessary**:

- Tree becomes exactly the state before earliest undone step.  
- Prior revert’s mixed working tree is discarded by checkout.

**Keep a safety branch only if tests prove** uncommitted non-tracked dirt blocks checkout:

```
// optional pre-step
if (session.revert?.snapshot && isFurtherBack(input, session.revert)) {
  // clear dirty state by restoring redo anchor first — only if required by fossil
}
```

Default algorithm for SP-03:

```
1. collect patches after M
2. if patches empty → setRevert message-only / cleanup; return
3. targetHash = patches[0].hash
4. conflicts = bak scan (existing)
5. anchor = checkpoint(); if !anchor → fail
6. rev = { messageID, partID, snapshot: anchor, op_id: anchor }
7. revertTo(targetHash, { preserveFiles: conflict files })
8. rev.diff = diff(anchor)  // informational
9. setRevert(...)
10. if patches empty already handled; if no files maybe cleanup messages
```

### 2.5 Unrevert

Unchanged intent after SP-02:

```
checkout(op_id) // hard fail if missing
clearRevert only on success
```

### 2.6 API

Add to `Snapshot.Interface` (`snapshot/index.ts` + fossil + any stubs):

```ts
readonly revertTo: (
  targetHash: string,
  opts?: { preserveFiles?: readonly string[] },
) => Effect.Effect<void>
```

**Migration:**

- `SessionRevert.revert` calls `revertTo`  
- Keep `revert(patches)` implemented as: derive `targetHash = patches[0]?.hash` + file list for deletes?  

**Deletion of files created after target:** full checkout + tracked extras cleanup should remove files that did not exist at target if they were tracked. New files only at leaf that were tracked get removed; never-tracked user files kept (SP-02).

**Deprecate** pure per-file path once session + snapshot tests pass. Prefer `revert(patches)` → thin wrapper:

```ts
if (!patches.length) return
const target = patches[0].hash
// optional: union of all patch.files for diagnostics only
yield* revertTo(target, opts)
```

Do **not** leave dual semantics (some callers per-file, some full) — pick one.

---

## 3. Prior art

| Source | Relevance |
|--------|-----------|
| `plans/fossil-undo-redo-fix.md` Fix BUG-3/4 | Pseudocode |
| `test/session/revert-compact.test.ts` | Effect harness for SessionRevert |
| `test/snapshot/snapshot.test.ts` | Many `revert(patches)` cases — **must update** expectations if API meaning changes |
| Message IDs ascending | `MessageID.ascending()` — string compare works for order |

**REUSE:** extend existing layers; no new SCM.

---

## 4. Implementation steps (ordered, small medoids)

### Step A — Research commit in fossil (30–60 min)

Compare on Windows temp repo:

- `fossil checkout --force HASH`  
- `fossil update HASH`  

Record: which leaves extras, which affects undo stack, which matches agent needs.

Stamp under `## FOSSIL.CMD.RESEARCH`.

**Default preference:** keep `checkout --force` for unrevert/restore consistency with Phase 1 tests; only switch if research shows update is strictly safer for SP-03.

### Step B — `revertTo` in fossil.ts

- Unit/integration tests in snapshot package **before** wiring SessionRevert  
- Preserve SP-02 extras + validateHash  

### Step C — Snapshot interface + wrapper

- Export `revertTo`  
- `revert(patches)` → wrapper (single hash)  
- Update `snapshot.test.ts` cases that relied on per-file multi-hash quirks  

Critical tests that may change meaning:

- `revert with overlapping files across patches uses first patch hash`  
- `revert preserves patch order when the same hash appears again`  

New semantics: **all files** go to `patches[0].hash` tree, not first-seen per file (same if hashes equal; different if multi-hash — full tree wins).

### Step D — SessionRevert.revert rewrite

- File: `packages/opencode/src/session/revert.ts`  
- Algorithm §2.4  
- Remove stale `session.revert?.snapshot ??`  
- Unrevert: only clearRevert after success (SP-02 may already)

### Step E — BUG-8 minimal

In `processor.ts` cleanup: if aggregate patch emitted, hash must be `ctx.snapshot` (already) **after** track (Phase 1 BUG-5).  

Add test: cleanup after multi write still has resolvable hash.  

Optional improvement: store step hashes array on ctx — only if tests show aggregate breaks multi-undo.

### Step F — Session-level real tests (see §6)

### Step G — Master G3 gate

---

## 5. Smoke Tests

### SMOKE.BEFORE (after SP-02 only)

```
cwd: packages/opencode
bun typecheck
bun test test/snapshot/
bun test test/session/revert-compact.test.ts
# Record Exact — must already meet master G2
```

### POST_IMPL oracles

| # | Oracle | Pass |
|---|--------|------|
| U1 | `bun typecheck` | 0 |
| U2 | `bun test test/snapshot/` | 0 fail |
| U3 | `bun test test/session/revert-compact.test.ts` | 0 fail |
| U4 | New multi-undo suite §6 | 0 fail |
| U5 | Grep: SessionRevert does not use prior snapshot as new rev.snapshot | code review |
| U6 | Grep: no per-file multi-hash loop in session path | code review |

### Optional TUI smoke (highly recommended before calling SP-03 done)

```
pwsh _build.ps1 -SkipOpenTui   # if only TS
cmd_runner start --cwd dist/bin -- opencode.exe
# /new → ask agent to write a.txt "v1", then "v2", then "v3"
# UI undo to after v1 → file must be v1
# undo further → empty or pre-v1 Exact
# unrevert → back to pre-first-undo Exact
```

Stamp outcomes in `## TUI.SMOKE`.

---

## 6. Real tests (mandatory — no mocks)

### 6.1 New file: `packages/opencode/test/session/session-undo-fossil.test.ts`

Harness: copy patterns from `revert-compact.test.ts` (`testEffect`, `provideTmpdirInstance`, Session + SessionRevert + SnapshotFossil layers).

**Scenario helper:**

```
create session
user msg → assistant msg + patch part after real track()
# Prefer: use Snapshot.track() + updatePart type patch with real hash/files
# Writing files with fs then track() — Exact fossil hashes
```

| Test ID | Scenario | Exact assert |
|---------|----------|--------------|
| SU-1 | Single undo | file content == state at targetHash |
| SU-2 | Undo then unrevert | content == pre-undo |
| SU-3 | Double undo further back | after second undo, content == earlier target; `rev.snapshot` ≠ first undo’s snapshot (fresh each time) |
| SU-4 | Double undo then unrevert | content == state before second undo’s mutation (anchor of second) |
| SU-5 | Undo with user-only untracked file present | user file still exists (I-4) |
| SU-6 | Undo with user edit vs bak conflict | `rev.conflicts` non-empty; conflict file content preserved from bak policy |
| SU-7 | Invalid patch hash | fail loud; no partial setRevert OR setRevert without tree lie |
| SU-8 | Empty patches (read-only tools) | no fossil call; cleanup messages works (existing compact tests) |
| SU-9 | Overlapping files multi-patch | tree equals **first patch hash** full tree (not mixed) |

### 6.2 Snapshot layer

| Test ID | Assert |
|---------|--------|
| RT-1 | `revertTo` invalid hash fails |
| RT-2 | `revertTo` + preserveFiles restores those paths from pre-copied bak fixtures |
| RT-3 | `revert(patches)` wrapper equals `revertTo(patches[0].hash)` for multi-file |

### 6.3 Regression

Keep `revert-compact` tests green (message removal semantics independent of tree).

---

## 7. Risk register (SP-03 specific)

| Risk | Detection | Mitigation |
|------|-----------|------------|
| Full checkout deletes user changes | SU-6 | preserveFiles + bak |
| Full checkout deletes user untracked | SU-5 | SP-02 extras |
| snapshot.test.ts mass fail | CI | update tests to single-hash semantics; do not weaken asserts |
| checkpoint() undefined | SU-7 style | fail before setRevert |
| ID compare for further-back | unit | use same ordering as message walk (`>=` already used in cleanup) |
| HTTP API undo errors | route test or manual | map Effect fail to 4xx/5xx JSON |

---

## 8. What NOT to do

- No half-merge that only fixes BUG-3 text but leaves per-file multi-hash  
- No reintroduction of `getEarliestCommit` fallback  
- No `fossil clean --force`  
- No mocks of fossil in correctness tests  
- No system prompt / KV-sensitive edits  

---

## 9. Checklist

- [ ] SP-02 G2 confirmed  
- [ ] FOSSIL.CMD.RESEARCH stamped  
- [ ] `revertTo` + tests RT-*  
- [ ] `revert(patches)` wrapper  
- [ ] SessionRevert algorithm §2.4  
- [ ] SU-1…SU-9 green  
- [ ] snapshot suite green  
- [ ] U1–U6 + optional TUI  
- [ ] Update `fossil-undo-redo-fix.md`: BUG-3, BUG-4 Done  
- [ ] Master G3 `[x]`  

---

## FOSSIL.CMD.RESEARCH

| Command | extras? | history? | notes |
|---------|---------|----------|-------|
| checkout --force | | | |
| update HASH | | | |

## TUI.SMOKE

| Step | Actual |
|------|--------|
| | |

---

## Exit criteria

Master G3. Commit suggestion:

`fix(session): full-checkout undo with fresh redo anchors (BUG-3/4)`
