# Plan 8: Migration Cleanup

## Problem

Three snapshot backends coexist in the codebase:
1. `index.ts` (git) — original, still works
2. `jj.ts` — experimental, never worked properly
3. `fossil.ts` — new, partially working

Runtimes import `SnapshotFossil` but git snapshot (`index.ts`) remains as fallback.

## Current Import Chain

```
bootstrap-runtime.ts → SnapshotFossil.defaultLayer
app-runtime.ts       → SnapshotFossil.defaultLayer
processor.ts         → SnapshotFossil.defaultLayer
summary.ts           → SnapshotFossil.defaultLayer
revert.ts            → SnapshotFossil.defaultLayer
```

## Migration States

### State 1: Current (fossil wired, git fallback exists)
- Fossil is "active" but broken (path/command issues)
- Git snapshot can be restored by reverting imports
- jj.ts exists but unused

### State 2: Fossil Working (target of this plan)
- Fossil tested and verified
- Git snapshot still exists as import-able fallback
- jj.ts can be removed or kept as reference

### State 3: Fossil Only (future)
- Git snapshot module removed
- Only fossil backend
- jj.ts removed

## Cleanup Tasks

1. **Remove jj.ts** — or move to `experiments/` for reference
2. **Remove jj runtime imports** — already replaced with fossil imports
3. **Remove `ensureGitignore()` from jj.ts** — no longer needed
4. **Keep `index.ts` (git) as-is** — importable fallback, no changes needed
5. **Add config toggle** — `snapshot.backend = "fossil" | "git"` for switching

## Rollback Plan

If fossil doesn't work:
1. Change runtime imports back to `Snapshot.defaultLayer`
2. Git snapshot takes over immediately
3. No data loss (fossil repo stays, just unused)

## Acceptance Criteria

- [ ] Fossil backend works end-to-end (init → track → rollback)
- [ ] Git snapshot importable as fallback
- [ ] No jj code in active import paths
- [ ] Config option to switch backends
- [ ] Clean `git status` (no orphaned jj artifacts)
