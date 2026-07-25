# Fix: SnapshotFossil checkout initialization invalidates captured hashes

## Status

Completed 2026-07-14. The snapshot-race integration test passes with a non-empty session diff.

## Root Cause

Several production snapshot consumers can share a Fossil checkout. `fossil open --force` is required for a non-empty worktree, but it is not idempotent: it returns `there is already an open tree` when that checkout is already active.

`SnapshotFossil.ensureInit()` treated that response as checkout corruption, closed the checkout, deleted `snapshot.fsl`, and initialized a new repository. Snapshots captured before that recovery no longer existed, so `computeDiff()` resolved both hashes to fallback history and returned no file changes.

The configuration is enabled in the integration fixture; `Config.Service` isolation was not the cause.

## Fix

`packages/opencode/src/snapshot/fossil.ts` now:

- retains `--force` when opening a non-empty worktree;
- calls `fossil info` after an `already an open tree` response;
- reuses the checkout only when its repository path matches the expected `snapshot.fsl` path;
- refuses destructive recovery when the active checkout belongs to another repository;
- returns a safe empty result when initialization cannot establish the expected checkout.

## Verification

```
bun test test/session/snapshot-tool-race.test.ts --timeout 60000
```

Result: 1 pass, 0 fail. The test exercised the normal production `SnapshotFossil.defaultLayer` and completed in 17.96 seconds.
