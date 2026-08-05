# Fossil Snapshot System: Undo/Redo Architecture Audit & Fix Plan

**Date:** 2026-08-05
**Status:** Phase 1 complete ✅ | Phase 2 pending | Phase 3 pending
**Severity:** CRITICAL — data loss, silent corruption, broken undo/redo
**Commit:** `eb3b6a3` — fix(snapshot): Phase 1 — stop silent data loss in undo/redo

**Execution (2026-08-05):** Phase 2/3 implementation is tracked by the critical remediation master and sub-plans — do not implement ad-hoc outside them:

| Phase | Plan |
|-------|------|
| Phase 2 residual (extras, hard-fail checkout) | `plans/2026-08-05_sp02_fossil_layer_safety.md` |
| Phase 2 semantics (BUG-3, BUG-4) | `plans/2026-08-05_sp03_session_undo_semantics.md` |
| Phase 3 atomic + integration | `plans/2026-08-05_sp05_phase3_atomic_integration.md` |
| Master DAG / gates | `plans/2026-08-05_master_critical_remediation.md` |

---

## 1. Executive Summary

The Fossil automatic agent snapshot system has accumulated multiple architectural and implementation defects that make undo/redo unreliable. The core issue is a **design tension** between two undo paradigms — full-checkout rollback vs per-file selective revert — implemented without clear invariants for their interaction. This plan documents every identified defect, its root cause, and a concrete fix.

**Impact:** Undo can silently restore files to the initial empty state (`opencode-init`), `fossil clean --force` can delete user files, stale revert snapshots corrupt second-level undo, and self-healing init can destroy the entire Fossil history making all stored hashes invalid.

---

## 2. Process Diagram: Full Lifecycle

### 2.1 Snapshot Creation (Track)

```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐
│ Agent edits  │───▶│ processor.ts  │───▶│ fossil.ts    │───▶│ Fossil repo  │
│ files via    │    │ create()      │    │ track(files) │    │ snapshot.fsl │
│ write/edit   │    │               │    │              │    │              │
└──────────────┘    │ ctx.snapshot =│    │ 1. add/rm    │    │ New checkin  │
                    │ checkpoint()  │    │ 2. commit    │    │ with hash    │
                    │ (fast info)   │    │ 3. sym tag   │    │              │
                    └───────────────┘    └──────────────┘    └──────────────┘
                           │                     │
                           ▼                     ▼
                    ┌──────────────┐    ┌──────────────────┐
                    │ step-finish  │    │ CodeGraph MCP     │
                    │ part written │    │ structural tag    │
                    │ with hash    │    │ (sym tag on hash) │
                    └──────────────┘    └──────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ patch part   │
                    │ { hash:      │  hash = snapshot BEFORE this step
                    │   beforeHash,│  files = changed in this step
                    │   files }    │
                    └──────────────┘
```

**Key invariant:** Each `patch` part stores `hash` = the Fossil checkin hash BEFORE the agent step's changes, and `files` = absolute paths of files modified. The `hash` is a Fossil artifact ID that identifies the exact tree state.

### 2.2 Undo (Revert) Flow

```
User triggers undo
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ SessionRevert.revert(input)                          │
│                                                      │
│ 1. Walk all messages, find revert point              │
│ 2. Collect all patch parts AFTER revert point        │
│ 3. rev.snapshot = prev_revert?.snapshot              │
│    ?? snap.checkpoint()    ◀── BUG: stale on 2nd undo│
│ 4. rev.op_id = prev_revert?.op_id ?? rev.snapshot    │
│ 5. if prev_revert?.snapshot:                         │
│      snap.restore(prev_revert.snapshot) ◀── BUG:     │
│      restores to WRONG state on 2nd undo             │
│ 6. snap.revert(patches)                              │
│                                                      │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ fossil.ts: revert(patches)                           │
│                                                      │
│ For each patch (chronological order):                │
│   For each file in patch.files:                      │
│     if file NOT in seen set:                         │
│       seen.add(file)                                 │
│       resolvedHash = resolveHash(patch.hash)         │
│         ├─ fossil info <hash> → exists?              │
│         └─ NO → getEarliestCommit() ◀── CRITICAL BUG │
│       fossil revert <file> -r <resolvedHash>         │
│         ├─ OK → file restored                        │
│         └─ FAIL → fs.remove(file) (file didn't exist)│
│                                                      │
│ fossil commit -m "revert" ◀── commits mixed state    │
└──────────────────────────────────────────────────────┘
```

### 2.3 Redo (Unrevert) Flow

```
User triggers unrevert
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ SessionRevert.unrevert(input)                        │
│                                                      │
│ if session.revert.op_id:                             │
│   snap.checkout(session.revert.op_id)                │
│   ┌─ fossil checkout --force <op_id>                 │
│   └─ fossil clean --force ◀── CRITICAL: deletes      │
│       ALL untracked files, not just agent-created    │
│ else if session.revert.snapshot:                     │
│   snap.restore(session.revert.snapshot)              │
│   ┌─ fossil checkout --force <snapshot>              │
│   └─ fossil clean --force ◀── same bug               │
│                                                      │
│ sessions.clearRevert(sessionID)                      │
└──────────────────────────────────────────────────────┘
```

### 2.4 Self-Healing Init (Destructive Path)

```
ensureInit() called
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ repo exists? ──YES──▶ probe fossil info              │
│   │                    ├─ OK, same repo → return true │
│   │                    └─ FAIL → fossil open --force  │
│   │                         ├─ OK → verify → return   │
│   │                         └─ FAIL ↓                 │
│   │                                                  │
│   NO                                                 │
│   ↓                                                  │
│ fossil init → open → baseline commit                 │
│                                                      │
│ ═══════════ DESTRUCTIVE RECOVERY ═══════════         │
│ fossil close --force                                 │
│ fs.remove(repoPath)        ◀── DELETES ALL HISTORY   │
│ clearCheckoutMarkers()                               │
│ → re-init, re-open, baseline commit                  │
│                                                      │
│ All stored hashes now INVALID → resolveHash          │
│ falls back to earliest (opencode-init) → data loss   │
└──────────────────────────────────────────────────────┘
```

### 2.5 Phase 1 Post-Fix Flows (2026-08-05)

#### Undo (Revert) — AFTER Phase 1

```
User triggers undo
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ SessionRevert.revert(input)                          │
│                                                      │
│ 1. Walk all messages, find revert point              │
│ 2. Collect all patch parts AFTER revert point        │
│ 3. rev.snapshot = prev_revert?.snapshot              │
│    ?? snap.checkpoint()    ◀── BUG-3: still stale    │
│ 4. rev.op_id = prev_revert?.op_id ?? rev.snapshot    │
│ 5. if prev_revert?.snapshot:                         │
│      snap.restore(prev_revert.snapshot) ◀── BUG-3    │
│ 6. snap.revert(patches)                              │
│                                                      │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ fossil.ts: revert(patches) — AFTER Phase 1           │
│                                                      │
│ For each patch (chronological order):                │
│   For each file in patch.files:                      │
│     if file NOT in seen set:                         │
│       seen.add(file)                                 │
│       resolvedHash = resolveHash(patch.hash)         │
│         ├─ fossil info <hash> → exists?              │
│         └─ NO → Effect.fail(Error) ✅ HARD ERROR     │
│       fossil revert <file> -r <resolvedHash>         │
│         ├─ OK → file restored                        │
│         └─ FAIL → fs.remove(file)                    │
│                                                      │
│ fossil commit -m "revert"                            │
│   ├─ OK → done                                       │
│   └─ FAIL → log.warn("bug: revert commit failed") ✅ │
└──────────────────────────────────────────────────────┘
```

#### Redo (Unrevert) — AFTER Phase 1

```
User triggers unrevert
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ SessionRevert.unrevert(input)                        │
│                                                      │
│ if session.revert.op_id:                             │
│   snap.checkout(session.revert.op_id)                │
│   ┌─ fossil info <op_id> → validate ✅ NEW           │
│   └─ fossil checkout --force <op_id>                 │
│   └─ fossil extras → scoped remove ✅ NOT clean -f   │
│                                                      │
│ sessions.clearRevert(sessionID)                      │
└──────────────────────────────────────────────────────┘
```

#### Self-Healing Init — AFTER Phase 1

```
ensureInit() called
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ repo exists? ──YES──▶ probe fossil info              │
│   │                    ├─ OK, same repo → return true │
│   │                    └─ FAIL → fossil open --force  │
│   │                         ├─ OK → verify → return   │
│   │                         └─ FAIL ↓                 │
│   │                                                  │
│   NO                                                 │
│   ↓                                                  │
│ fossil init → open → baseline commit                 │
│                                                      │
│ ═══════════ RECOVERY (NON-DESTRUCTIVE) ═══════════   │
│ fossil close --force                                 │
│ fs.copy(repoPath, backupPath) ✅ BACKUP FIRST         │
│ log.warn("bug: fossil repo corrupted...") ✅          │
│ fs.remove(repoPath)                                  │
│ clearCheckoutMarkers()                               │
│ → re-init, re-open, baseline commit                  │
│                                                      │
│ Stored hashes invalid → resolveHash throws Error ✅   │
│ (no silent fallback to empty state)                  │
└──────────────────────────────────────────────────────┘
```

---

## 3. Bug Catalog

### BUG-1 [CRITICAL] `resolveHash` falls back to earliest commit on hash miss

**File:** `packages/opencode/src/snapshot/fossil.ts:507-515`

**Root Cause:** When a patch's hash doesn't exist in Fossil (corruption, repo recreation, legacy migration), `resolveHash` silently falls back to `getEarliestCommit()` — the `opencode-init` baseline with ZERO user files.

**Effect:** All files in the patch are reverted to the empty initial state. All user/agent work is destroyed. Only a `log.warn` is emitted — the user sees no error.

**Trigger scenarios:**
- Self-healing init deleted and recreated the repo (BUG-7)
- Fossil repo corrupted and hash lookup fails
- Session references a hash from before a migration
- Hash is from a different Fossil repository

**Real production evidence:** `plans_completed/2026-07/2026-07-14_fix_snapshotfossil_config_isolation.md` documents this exact cascade: "`SnapshotFossil.ensureInit()` ... deleted `snapshot.fsl`, and initialized a new repository. Snapshots captured before that recovery no longer existed, so `computeDiff()` resolved both hashes to fallback history and returned no file changes." The fallback silently masked the data loss.

**Code:**
```typescript
const resolveHash = Effect.fnUntraced(function* (hash: string) {
    const check = yield* fossil(["info", hash], { cwd: worktree })
    if (check.code === 0) return hash
    // ⚠️ SILENT DATA LOSS: falls back to earliest = empty state
    const earliest = yield* getEarliestCommit()
    log.warn("hash not found in fossil, using earliest", { hash, fallback: earliest })
    return earliest ?? hash
})
```

### BUG-2 [CRITICAL] `fossil clean --force` deletes user files

**File:** `packages/opencode/src/snapshot/fossil.ts:409,450`

**Root Cause:** After `fossil checkout --force <hash>`, untracked "extra" files remain in the working tree. `fossil clean --force` removes them. But this removes ALL untracked files, including files the USER created manually (not via agent tools), files created by other processes, and build artifacts not in `.gitignore`.

**Effect:** Unrevert and restore operations can delete files the user created outside of the agent workflow. This is unrecoverable (no recycle bin).

**Nuance:** `fossil clean` respects `ignore-glob` (synced from `.gitignore`) and auto-ignores dotfiles unless `--dotfiles` is passed. So `.gitignore`-listed files and dotfiles are protected. However, any regular file that is untracked by BOTH fossil AND `.gitignore` (e.g., a user's manual `notes.txt`, build artifacts not in `.gitignore`, or files created by other tools) will be silently deleted.

**Code:**
```typescript
// opRestore (line 402-409)
yield* fossil(["checkout", "--force", targetVersion], { cwd: worktree })
yield* fossil(["clean", "--force"], { cwd: worktree })  // ⚠️ DELETES USER FILES

// restore (line 443-450) — identical pattern
yield* fossil(["checkout", "--force", snapshot], { cwd: worktree })
yield* fossil(["clean", "--force"], { cwd: worktree })  // ⚠️ SAME BUG
```

### BUG-3 [CRITICAL] Second-level undo restores to wrong state

**File:** `packages/opencode/src/session/revert.ts:131-134`

**Root Cause:** When a session is already reverted and the user undoes again (to an even earlier point), the code unconditionally restores to `session.revert.snapshot` — which is the hash BEFORE the first undo (i.e., the full forward state including all original steps). This wipes out the first undo's effects and brings back all originally-undone changes.

**Scenario:**
1. Agent does steps 1, 2, 3 → files at state S3
2. User undoes to step 1 → files at state S1 (steps 2,3 undone)
3. Agent does step 4 → files at state S1+4
4. User undoes step 4 → code restores to `session.revert.snapshot` = S3, then applies step 4 patch → files at state S3 (steps 2,3 are BACK, step 4 undone)

**Expected:** After step 4 undo, files should be at state S1 (step 4 undone, steps 2,3 still undone).

**Code:**
```typescript
rev.snapshot = session.revert?.snapshot ?? (yield* snap.checkpoint())
rev.op_id = session.revert?.op_id ?? rev.snapshot
if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot) // ⚠️ WRONG
yield* snap.revert(patches)
```

### BUG-4 [HIGH] Per-file revert creates inconsistent mixed states

**File:** `packages/opencode/src/snapshot/fossil.ts:455-482`

**Root Cause:** The `revert(patches)` function reverts each file to DIFFERENT Fossil versions (each patch's hash), then commits the result as a single "revert" checkin. This mixed state never existed in history and may be inconsistent (e.g., file A reverted to version where it references function foo(), but file B is at a version where foo() was renamed to bar()).

**Effect:** After undo, the working tree contains a Frankenstein state. If the agent continues working from this state, it may produce incorrect results. The revert commit captures this inconsistent state as if it were valid.

**Mitigation in code:** The `seen` set prevents reverting the same file multiple times, using the FIRST (earliest) hash. This is correct for linear undo but fragile — if patches are out of order or from non-linear history, the result is undefined.

### BUG-5 [HIGH] `revert(patches)` uses working-tree diff, not committed diff

**File:** `packages/opencode/src/snapshot/fossil.ts:414-436`

**Root Cause:** `patch(hash)` calls `fossil diff --from hash --brief` which diffs from `hash` to the CURRENT WORKING TREE, not to HEAD. If there are uncommitted changes (e.g., from a partially-completed tool step or from the user), the patch includes those alongside the committed changes.

**Effect:** A patch part may record files that were changed by a mix of committed and uncommitted modifications. During undo, `fossil revert -r <hash>` for such files would revert to the committed state, potentially discarding uncommitted user changes.

**Trigger:** Error/interrupt path where `cleanup()` calls `snapshot.patch(ctx.snapshot)` without a preceding `track()`.

### BUG-6 [HIGH] Revert commit failure silently ignored

**File:** `packages/opencode/src/snapshot/fossil.ts:477-479`

**Root Cause:** The final `fossil commit -m "revert"` in `revert(patches)` uses `.pipe(Effect.catch(() => Effect.void))` — if the commit fails, the per-file reverts are already applied to the working tree but there's no Fossil record.

**Effect:** Working tree is modified but uncommitted. Next `track()` would commit these changes as a regular "auto-snapshot" rather than as a revert. The revert anchor (`session.revert.op_id`) points to a hash, but the Fossil history doesn't contain a corresponding revert checkin.

### BUG-7 [CRITICAL] Self-healing init destroys Fossil history

**File:** `packages/opencode/src/snapshot/fossil.ts:233-239`

**Root Cause:** When `fossil open` fails (corrupted DB, stale checkout, etc.), the recovery path DELETES the entire `snapshot.fsl` repository and recreates it from scratch. All snapshot history is lost. All hashes stored in the session DB become invalid.

**Effect:** Combined with BUG-1, this creates a catastrophic cascade: repo deleted → all hashes invalid → `resolveHash` falls back to earliest commit → undo reverts everything to empty state.

**Code:**
```typescript
yield* fossil(["close", "--force"], { cwd: worktree }).pipe(Effect.catch(() => Effect.void))
yield* fs.remove(repoPath).pipe(Effect.catch(() => Effect.void)) // ⚠️ DELETES ALL HISTORY
yield* clearCheckoutMarkers(fs, worktree)
```

### BUG-8 [MEDIUM] `cleanup()` patch captures multi-step changes as single patch

**File:** `packages/opencode/src/session/processor.ts:790-804`

**Root Cause:** In the error/interrupt cleanup path, `ctx.snapshot` may be the initial snapshot from `create()` (before any tool calls). The patch would aggregate ALL changes from the entire turn into one patch part, losing per-step granularity.

**Effect:** During undo, instead of reverting individual steps, all changes are grouped. If the user undoes to a point within the turn, the granularity is lost.

### BUG-9 [MEDIUM] `fossil checkout --force` on non-existent hash fails silently

**File:** `packages/opencode/src/snapshot/fossil.ts:397-412`

**Root Cause:** `opRestore` does NOT use `resolveHash` — it passes the hash directly to `fossil checkout --force`. If the hash doesn't exist, Fossil fails with a non-zero exit code, which is logged but the error is swallowed (the function returns `undefined`/`void`).

**Effect:** Unrevert can silently fail — the user thinks they unreverted but the working tree is unchanged. No error is surfaced to the UI.

**Contrast with `revert(patches)`:** uses `resolveHash` which has the fallback bug (BUG-1), while `checkout`/`restore` have no fallback at all (silent failure).

### BUG-10 [MEDIUM] No transactionality in revert

**File:** `packages/opencode/src/snapshot/fossil.ts:455-482`

**Root Cause:** Per-file `fossil revert` operations are not atomic. If revert of file 3 out of 10 fails, files 1-2 are already reverted, files 4-10 are not yet processed, and the `seen` set is partially populated. The revert commit still runs (or is silently skipped per BUG-6), leaving the working tree in a partially-reverted state.

---

## 4. Root Cause Analysis

### Architectural Problem: Two Conflicting Paradigms

The system tries to serve two masters:

| Paradigm | Mechanism | Pros | Cons |
|----------|-----------|------|------|
| **Full checkout** | `fossil checkout --force <hash>` + `clean` | Atomic, consistent state | Deletes untracked files, can't preserve user changes |
| **Per-file revert** | `fossil revert <file> -r <hash>` per file | Selective, preserves other files | Non-atomic, mixed states, hash resolution fragile |

The current code uses **per-file revert** for session undo (so user changes are preserved) and **full checkout** for unrevert (to go back to exact pre-undo state). But the boundary between these paradigms is not clearly defined, and the interaction between successive undo/redo operations creates cascading failures.

### Design Flaw: Hash as Opacity Token

The system treats Fossil checkin hashes as opaque tokens that can be stored and later resolved. But:
1. Hashes become invalid if the repo is recreated (BUG-7)
2. `resolveHash` has a catastrophic fallback (BUG-1)
3. Hashes reference exact tree states but per-file revert creates states that never existed (BUG-4)
4. No hash validation at storage time — invalid hashes are persisted without error

### Missing Invariant: Clean Boundary

`fossil clean --force` is called unconditionally after checkout, but there's no invariant ensuring that only agent-created files are cleaned. The ignore-glob protects `.gitignore`-listed files but NOT user files that happen to be untracked by both git and fossil.

---

## 5. Proposed Fixes

### Fix Priority Matrix

| Bug | Severity | Fix Complexity | Risk of Fix | Must Fix |
|-----|----------|---------------|-------------|----------|
| BUG-1 | CRITICAL | Low | Low | ✅ |
| BUG-2 | CRITICAL | Medium | Medium | ✅ |
| BUG-3 | CRITICAL | High | High | ✅ |
| BUG-7 | CRITICAL | Medium | Low | ✅ |
| BUG-4 | HIGH | High | High | ✅ |
| BUG-5 | HIGH | Low | Low | ✅ |
| BUG-6 | HIGH | Low | Low | ✅ |
| BUG-9 | MEDIUM | Low | Low | ✅ |
| BUG-10 | MEDIUM | Medium | Medium | ⬜ (Phase 2) |
| BUG-8 | MEDIUM | Low | Low | ✅ |

### Fix BUG-1: Remove destructive fallback in `resolveHash`

**Change:** Replace the "earliest commit" fallback with a hard error.

```typescript
const resolveHash = Effect.fnUntraced(function* (hash: string) {
    const check = yield* fossil(["info", hash], { cwd: worktree })
    if (check.code === 0) return hash
    
    // Hash invalid — fail hard instead of silent data loss
    log.error("bug: fossil hash not found, undo may be unreliable", { 
        hash, 
        stderr: check.stderr,
        hint: "Fossil repository may have been recreated or corrupted"
    })
    return yield* Effect.fail(new Error(
        `Snapshot hash ${hash.slice(0, 8)} not found in Fossil repository. ` +
        `Undo cannot proceed safely. The repository may have been recreated.`
    ))
})
```

**Impact (blast radius):** `resolveHash` is called by FOUR consumers, all must handle the new hard error:
| Consumer | File:Line | Path |
|----------|-----------|------|
| `revert(patches)` | fossil.ts:466 | Session undo per-file revert |
| `diff(hash)` | fossil.ts:488 | Called by `revert.ts:135` during undo flow (`rev.diff = yield* snap.diff(rev.snapshot)`) |
| `diffFull(from, to)` | fossil.ts:523-524 | Summary diff computation |
| `impact(from, to)` | fossil.ts:605-606 | Structural impact analysis |

The `diff(hash)` consumer was initially missed in analysis — it is reachable from the undo flow and must be updated to handle the error gracefully (log + return empty diff rather than crashing the undo).

### Fix BUG-2: Replace `fossil clean --force` with scoped cleanup

**Change:** Instead of `fossil clean --force` (deletes ALL extras), compute the set of files that should be removed post-checkout and only delete those.

```typescript
// After fossil checkout --force <target>:
// 1. Get list of files that exist NOW but didn't exist at <target>
// 2. Only delete those specific files
// 3. Never delete files the user created outside agent workflow

const opRestore = Effect.fnUntraced(function* (targetVersion: string) {
    // ... checkout ...
    
    // Instead of: yield* fossil(["clean", "--force"], { cwd: worktree })
    // Do scoped cleanup:
    const extras = yield* fossil(["extras"], { cwd: worktree })
    if (extras.code === 0) {
        const extraFiles = extras.text.trim().split("\n").filter(Boolean)
        // Only remove files that were tracked by fossil at some point
        // (i.e., were created by agent snapshots, not user files)
        for (const file of extraFiles) {
            const wasTracked = yield* fossil(["info", file, "-R", repoPath], { cwd: worktree })
            if (wasTracked.code === 0) {
                yield* fs.remove(path.join(worktree, file)).pipe(Effect.catch(() => Effect.void))
            }
        }
    }
})
```

**Alternative (safer):** Remove `fossil clean --force` entirely and instead use `fossil checkout --force --latest` which updates to the latest version without leaving extras. Or use `fossil update <hash>` instead of `fossil checkout --force` (update merges, checkout replaces).

**Recommended approach:** Replace `checkout --force` + `clean --force` with `fossil update <hash>` (which preserves local changes and handles extras more gracefully) OR wrap the checkout in a stash/pop cycle.

### Fix BUG-3: Correct second-level undo semantics

**Change:** When doing a second undo, the code must distinguish between:
- **Undo further back** (new revert point is EARLIER than previous): restore to pre-first-undo state, then collect ALL patches from the further-back point
- **Undo from current state** (new revert point is LATER than previous): just collect patches from the new point, don't restore

```typescript
const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
    // ...
    
    // Determine if this is a second-level undo
    const hasPriorRevert = session.revert != null
    const isFurtherBack = hasPriorRevert && input.messageID < session.revert!.messageID
    
    if (isFurtherBack) {
        // Undoing to an even earlier point:
        // 1. Restore to original state (before first undo)
        yield* snap.restore(session.revert!.snapshot!)
        // 2. Collect ALL patches from the NEW (earlier) revert point
        //    (patches collection already does this — it walks from input.messageID forward)
    }
    
    // For non-further-back undo: don't restore, just collect patches from current state
    
    rev.snapshot = yield* snap.checkpoint()  // Always use FRESH checkpoint
    rev.op_id = rev.snapshot
    
    yield* snap.revert(patches)
    // ...
})
```

**Key insight:** `rev.snapshot` should ALWAYS be a fresh `checkpoint()` — the hash of the current state BEFORE this undo is applied. It should NEVER be carried over from a previous revert. The previous revert's snapshot is only used to restore state when undoing further back.

### Fix BUG-7: Make self-healing init non-destructive

**Change:** Instead of deleting the repo, attempt recovery via `fossil rebuild` or keep a backup.

```typescript
// Instead of:
yield* fs.remove(repoPath).pipe(Effect.catch(() => Effect.void))

// Do:
const backupPath = repoPath + ".bak." + Date.now()
yield* fs.copy(repoPath, backupPath).pipe(Effect.catch(() => Effect.void))
log.warn("bug: fossil repo corrupted, creating backup", { repoPath, backupPath })
yield* fs.remove(repoPath).pipe(Effect.catch(() => Effect.void))

// After re-init, log prominently that history was lost
log.warn("bug: fossil history lost — all stored snapshot hashes are now invalid", {
    repoPath,
    backupPath,
    recovery: "Session undo/revert will fail with clear errors. The old repo is preserved at: " + backupPath
})
```

**Additionally:** After re-init, mark the session DB to indicate that stored hashes are invalid, so undo operations can fail gracefully instead of hitting BUG-1.

### Fix BUG-4: Replace per-file revert with full checkout for session undo

**This is the most impactful fix.** Replace the per-file `fossil revert -r <hash>` approach with a full checkout to the target state.

**Rationale:** Per-file revert to different hashes creates inconsistent states. The conflict detection (`.bak` file comparison) is a heuristic that can't guarantee correctness. Full checkout to a known-good state is simpler, safer, and correct.

**New approach:**
1. Determine the target hash: the hash BEFORE the earliest message being undone
2. `fossil checkout --force <target_hash>` (without `clean --force` — see BUG-2 fix)
3. For files the user manually edited (detected via `.bak` comparison): restore those files from backup AFTER the checkout
4. Commit the result as the new state

```typescript
const revert = Effect.fnUntraced(function* (patches: Patch[], targetHash: string, userEditedFiles: string[]) {
    // Full checkout to target state
    yield* fossil(["checkout", "--force", targetHash], { cwd: worktree })
    
    // Restore user-edited files from backups
    for (const file of userEditedFiles) {
        const bakFile = yield* findBakFile(file)
        if (bakFile) {
            yield* fs.copy(bakFile, file)
        }
    }
    
    // Commit
    yield* fossil(["commit", "-m", "revert", "--no-warnings", "--allow-fork"], { cwd: worktree })
})
```

**Trade-off:** This loses the ability to revert SOME agent steps while keeping OTHERS if they touched the same files. But per-file revert was already broken for this case (BUG-4). The correct approach for selective undo is to revert entire steps (messages), not individual file changes.

### Fix BUG-5: Ensure patch() uses committed state

**Change:** In the processor's `finish-step`, the patch is already computed after `track()` commits. The bug is only in the `cleanup()` error path. Fix by committing before computing the patch in cleanup:

```typescript
const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
    if (ctx.snapshot) {
        // Commit any pending changes first
        if (ctx.hasWriteToolCall && ctx.changedFiles.size > 0) {
            yield* snapshot.track([...ctx.changedFiles]).pipe(Effect.catch(() => Effect.void))
        }
        const patch = yield* snapshot.patch(ctx.snapshot)
        // ...
    }
})
```

### Fix BUG-6: Surface revert commit failures

**Change:** Don't silently catch revert commit failures.

```typescript
const commitResult = yield* fossil(
    ["commit", "-m", "revert", "--no-warnings", "--allow-fork"], 
    { cwd: worktree }
)
if (commitResult.code !== 0) {
    log.warn("bug: revert commit failed, working tree is in modified state", {
        stderr: commitResult.stderr
    })
    // Don't fail the revert — the files are already reverted in the working tree.
    // Next track() will pick up the changes.
}
```

### Fix BUG-8: Don't emit multi-step aggregate patches in cleanup

**Change:** In the cleanup path, emit individual patches per-step rather than one aggregate patch. This requires tracking per-step snapshots (not just the initial one).

**Alternative (simpler):** In cleanup, after committing pending changes, emit a single patch for the entire remaining snapshot range. This is acceptable for error recovery since the exact per-step breakdown is less critical.

### Fix BUG-9: Add hash validation to checkout/restore

**Change:** Validate the hash before attempting checkout.

```typescript
const opRestore = Effect.fnUntraced(function* (targetVersion: string) {
    const check = yield* fossil(["info", targetVersion], { cwd: worktree })
    if (check.code !== 0) {
        log.error("bug: checkout hash not found", { targetVersion })
        return yield* Effect.fail(new Error(
            `Cannot checkout to ${targetVersion.slice(0, 8)}: hash not found in Fossil repository`
        ))
    }
    // Proceed with checkout...
})
```

### Fix BUG-10: Add atomicity to revert (Phase 2)

**Change:** Use Fossil's transaction or stash mechanism to make per-file revert atomic. If any file revert fails, abort the entire operation.

```typescript
// Before reverting: stash current state
yield* fossil(["stash", "save", "-m", "pre-revert"], { cwd: worktree })

try {
    // Per-file reverts...
    // Commit...
} catch {
    // Restore from stash
    yield* fossil(["stash", "pop"], { cwd: worktree })
}
```

---

## 6. Migration Path

### Phase 1: Stop the Bleeding (Immediate)

1. **BUG-1 fix:** Remove `getEarliestCommit()` fallback in `resolveHash` → hard error
2. **BUG-7 fix:** Don't delete repo on init failure → backup + reinit
3. **BUG-2 fix:** Replace `fossil clean --force` with scoped cleanup (or remove entirely)
4. **BUG-5 fix:** Commit before patch in cleanup path
5. **BUG-6 fix:** Don't silently catch revert commit failure
6. **BUG-9 fix:** Validate hash before checkout

### Phase 2: Fix the Architecture (Short-term)

1. **BUG-3 fix:** Correct second-level undo semantics
2. **BUG-4 fix:** Replace per-file revert with full checkout for session undo
3. **BUG-8 fix:** Per-step patches in cleanup

### Phase 3: Harden (Medium-term)

1. **BUG-10 fix:** Atomic revert via stash
2. Add hash validation at storage time (when patch parts are written, verify the hash exists)
3. Add session DB marker for "history lost" after repo recreation
4. Add integration tests for all undo/redo scenarios

---

## 7. Test Plan

### New Test Cases Required

1. **resolveHash with invalid hash** → must throw, not fall back
2. **revert after repo recreation** → must fail with clear error, not revert to empty
3. **Second-level undo** (undo → new work → undo again) → correct state
4. **Third-level undo** (undo → undo further → undo even further) → correct state
5. **Unrevert with invalid op_id** → must fail with clear error
6. **checkout/restore do not delete user files** → user's untracked files survive
7. **Self-healing init preserves old repo as backup** → `.bak` file exists
8. **Revert with 100 patches** → correct state (regression test for "100 steps back")
9. **Conflict detection still works** → user-edited files flagged after undo
10. **Empty patch list** → revert is a no-op (already handled but test it)

### Existing Tests to Fix

- `fossil-rollback.test.ts`: Several tests are `.skip`'d — need to investigate why and either fix or remove
- `fossil.test.ts`: Add test for `revert -r <nonexistent_hash>` → error, not fallback

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Changing undo semantics breaks existing reverted sessions | Add migration to clear stale `session.revert` data for sessions where hash validation fails |
| Full checkout (BUG-4 fix) deletes user changes | Implement `.bak` restore for user-edited files BEFORE checkout |
| Removing `clean --force` leaves stale files | Implement targeted cleanup based on `fossil extras` diffing |
| Phase 1 changes interact badly | Apply in order, test each independently, run full test suite between each fix |

---

## 9. Smoke Tests

### SMOKE.BEFORE (2026-08-05T10:29Z) — BASELINE CAPTURED

| Test Suite | Result | Detail |
|-----------|--------|--------|
| `fossil.test.ts` | ✅ **14 pass, 0 fail** | All Fossil CLI commands validated |
| `fossil-rollback.test.ts` | ❌ **4 pass, 2 skip, 1 fail** | `opRestore (checkout) preserves version history` fails at line 141: `fossil update h1` then `fossil update h3` returns "v2" not "v3" — **confirms rollback corruption bugs** |
| `fossil-track.test.ts` | ✅ **1 pass, 0 fail** | Track lifecycle smoke OK |
| `fossil-lifecycle.test.ts` | ✅ **6 pass, 0 fail** | Init/re-init lifecycle OK |
| `bun typecheck` | ⚠️ **20 errors in 3 files** | Pre-existing: `write.ts:31` (1), `transform-reasoning.test.ts:73` (11), `deepseek-defence.test.ts:108` (8). Not from Fossil. |

**Key finding:** The `fossil-rollback.test.ts` failure at line 141 (`expected "v3", received "v2"`) directly demonstrates the kind of rollback corruption described in BUG-2/BUG-4. After two successive `fossil update` operations, the file content does not match the target version. This validates the plan's diagnosis.

### SMOKE.AFTER Phase 1 (2026-08-05T10:36Z)

| Test Suite | SMOKE.BEFORE | SMOKE.AFTER | Delta |
|-----------|-------------|-------------|-------|
| `fossil.test.ts` | 14 pass, 0 fail | **14 pass, 0 fail** | ✅ |
| `fossil-rollback.test.ts` | 4 pass, 2 skip, **1 fail** | **5 pass, 2 skip, 0 fail** | ✅ **FIXED** |
| `fossil-track.test.ts` | 1 pass, 0 fail | **1 pass, 0 fail** | ✅ |
| `fossil-lifecycle.test.ts` | 6 pass, 0 fail | **6 pass, 0 fail** | ✅ |
| `bun typecheck` | 20 errors (3 files) | **20 errors (3 same files)** | ✅ no regressions |

**Rollback test fix:** The `opRestore (checkout) preserves version history` test now passes — replacing `fossil clean --force` with scoped `fossil extras` cleanup eliminated the file-state corruption across checkout cycles.

### SMOKE.AFTER Phase 2 / SP-01–03 (2026-08-05, commit `1116967541`)

| Test Suite | Result | Detail |
|-----------|--------|--------|
| `bun typecheck` | ✅ **0 errors** | write metadata fixed (SP-01); deepseek/transform fixed earlier |
| `session-undo-fossil.test.ts` | ✅ **6 pass** | structure h1/h2→h2'/h3→h4 both directions; multi-level redo_stack |
| `snapshot.test.ts -t revert` | ✅ **11 pass** | full-leaf + track() semantics |
| Full-leaf undo | ✅ | `revertTo` + preLs extras; user-only files kept |

**Phase 2 status:** BUG-3/4/9 residual addressed via full-leaf navigation + hard-fail checkout. Phase 3 (atomic, HISTORY_INVALID) still open — see `plans/2026-08-05_sp05_phase3_atomic_integration.md`.

### POST_FIX (after each phase)

```bash
# Full snapshot test suite
bun test test/snapshot/

# Typecheck
bun typecheck

# Manual smoke: create session, make edits, undo, verify state
```

---

## 10. Appendix: Key Files Reference

| File | Lines | Role |
|------|-------|------|
| `packages/opencode/src/snapshot/fossil.ts` | 810 | Core Fossil backend — all subprocess orchestration |
| `packages/opencode/src/snapshot/index.ts` | 81 | Snapshot service interface + types |
| `packages/opencode/src/session/revert.ts` | 232 | Session-level undo/redo logic |
| `packages/opencode/src/session/processor.ts` | 987 | Agent message processing — creates snapshots and patches |
| `packages/opencode/src/session/message-v2.ts` | ~300+ | Message part types including SnapshotPart, PatchPart |
| `packages/opencode/src/session/session.sql.ts` | 245 | DB schema — `session.revert` JSON column |
| `packages/opencode/test/snapshot/fossil.test.ts` | 246 | Fossil command validation tests |
| `packages/opencode/test/snapshot/fossil-rollback.test.ts` | 176 | Rollback/undo tests (several skipped) |
| `packages/opencode/test/snapshot/fossil-track.test.ts` | 59 | Track lifecycle smoke test |
| `packages/opencode/test/snapshot/fossil-lifecycle.test.ts` | 158 | Init/re-init lifecycle tests |
| `packages/opencode/test/snapshot/fossil-ignore.test.ts` | — | Ignore pattern tests |
