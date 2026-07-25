# Plan: Snapshot Regression Fixes

**Created:** 2026-07-03T02:58
**Status:** completed
**Completed:** 2026-07-03T03:00
**Goal:** Restore snapshot engine regressions introduced during jj→git revert (864041ba3)

## Root Cause

Commit `864041ba3` ("Switch snapshots to isolated git backend") reverted jj back to git but
introduced several regressions vs the Stable git version (`427136624`). These regressions cause
progressive performance degradation and eventual session hangs.

## Regressions to Fix

### S1: Cleanup loop removed [x]
- **Stable:** `Effect.forkScoped` loop running `git gc --prune=7.days` every hour
- **Current:** Loop deleted — gitdir grows unbounded
- **Fix:** Restore the fork loop from Stable
- **File:** `packages/opencode/src/snapshot/index.ts:747-757` (after `diffFull`)
- **Test:** Verify cleanup runs on schedule

### S2: ignore() reads from wrong gitdir [x]
- **Stable:** `"--git-dir", path.join(state.worktree, ".git")` — real worktree .git
- **Current:** Uses `quote` args → `--git-dir <snapshot_gitdir>` — isolated bare repo
- **Impact:** `check-ignore` misses `core.excludesfile` and worktree git config
- **Fix:** Use `path.join(state.worktree, ".git")` for check-ignore, same as Stable
- **File:** `packages/opencode/src/snapshot/index.ts:144-160`

### S3: drop()/stage() switched from stdin to CLI args [x]
- **Stable:** `--pathspec-from-file=-` + `--pathspec-file-nul` (one process, stdin)
- **Current:** `chunkArgs()` + CLI `--` args (multiple processes)
- **Impact:** More git processes per snapshot, more potential for Windows pipe deadlock
- **Fix:** Restore stdin-based approach from Stable
- **File:** `packages/opencode/src/snapshot/index.ts:162-188`

### S4: revert() uses op.rel instead of op.file [x]
- **Stable:** `git checkout <hash> -- <op.file>` (absolute path)
- **Current:** `git checkout <hash> -- <op.rel>` (relative path)
- **Impact:** Can fail if --work-tree doesn't match cwd
- **Fix:** Restore op.file for single-file checkout
- **File:** `packages/opencode/src/snapshot/index.ts:410-412`

### S5: blocked set persists across calls [x]
- **Stable:** `const block = new Set(...)` — local, recalculated each add() call
- **Current:** `const blocked = new Set<string>()` at closure level — accumulates forever
- **Impact:** Files blocked once stay blocked forever in exclude list
- **Fix:** Restore local block variable, remove persistent blocked set

## Verification

- `bun typecheck` from `packages/opencode`
- Snapshot tests if available
- Manual: open a session, verify snapshot tracking works

## Files Modified

- `packages/opencode/src/snapshot/index.ts`
