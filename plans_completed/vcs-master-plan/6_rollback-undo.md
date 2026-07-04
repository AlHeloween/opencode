# Plan 6: Rollback & Undo

## Problem

Session-level rollback via `op_id` has been wired into the schema and revert.ts, but the actual fossil commands have never been tested in the rollback flow.

## Two Rollback Levels

### Level 1: File-Level Revert (restore)
```
fossil revert <file> -r <version>
```
Reverts specific file to a previous version. Used by `revert(patches)`.

### Level 2: Session-Level Rollback (opRestore)
```
fossil update <version>
```
Updates entire checkout to a previous version. Used by `unrevert()` when `op_id` is available.

## What `op_id` Is in Fossil

Unlike jj (which has a separate operation log), Fossil's "op_id" is simply the **version hash** (check-in hash). So:
- `track()` returns version hash → stored as `session.revert.snapshot`
- `opId()` returns current version hash → stored as `session.revert.op_id`
- `opRestore(hash)` = `fossil update hash`

## Critical Issue: `fossil update` With Local Changes

`fossil update <version>` with uncommitted local changes creates CONFLICT warnings. For our use case:
- Before rollback, we should commit current state (or discard)
- `fossil update --force` might be needed (check if flag exists)
- Alternative: `fossil stash` before update, then `fossil stash pop` after

## `fossil undo`

`fossil undo` reverts the last operation. This is useful for quick undo of a bad snapshot. But:
- It only goes back ONE step
- It doesn't help with multi-step rollback
- It's complementary to `fossil update <hash>`

## Test Scenarios

1. Create snapshot A, modify file, create snapshot B
   - `restore(A)` → file reverted to A's state
   - `opRestore(A)` → entire checkout at A's state
2. Create snapshot, revert, verify `fossil undo` works
3. Rollback with uncommitted changes → verify no data loss
4. Rollback to non-existent version → verify error handling

## Acceptance Criteria

- [ ] `restore(hash)` reverts specific files correctly
- [ ] `opRestore(hash)` reverts entire checkout
- [ ] `fossil undo` works after restore
- [ ] No data loss during rollback with local changes
- [ ] Error handling for invalid hashes
