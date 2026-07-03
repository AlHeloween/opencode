# Plan 4: Init Lifecycle

## Problem

Self-healing init has multiple failure modes:
1. `fossil init` creates repo but `fossil open` fails (non-empty dir)
2. `fossil open --keep` may overwrite local files
3. `.fossil-settings/ignore-glob` not created before first commit
4. Multiple processes may try to init simultaneously
5. User deletes `.fsl` file → must re-init seamlessly

## State Machine

```
[No Repo] → fossil init → fossil open --keep → [Ready]
    ↑                                               │
    │          fossil broken/missing                 │
    └────────────────────────────────────────────────┘
```

## Correct Init Sequence

```
1. findFossil() → binary path or error
2. ensureIgnoreGlob() → create .fossil-settings/ignore-glob BEFORE init
3. Check if repoPath (.fsl) exists
   a. NO  → fossil init repoPath
   b. YES → skip init
4. Check if checkout exists (_FOSSIL_ or _fossil marker)
   a. NO  → fossil open repoPath --keep
   b. YES → skip open
5. Check if any commits exist
   a. NO  → fossil commit -m "opencode-init" --no-warnings
   b. YES → skip initial commit
6. [Ready]
```

## Key Ordering

`ensureIgnoreGlob()` MUST run BEFORE `fossil init` because:
- Fossil starts tracking files on `fossil open`
- If ignore patterns aren't set, node_modules/ gets tracked
- First commit would include everything

## Error Recovery

| Failure | Recovery |
|---|---|
| `fossil init` fails | Delete partial .fsl, retry once |
| `fossil open` fails | Check if already open, skip |
| `fossil commit` fails | "nothing to commit" = OK, other = log error |
| .fsl deleted by user | Detect on next call, re-init from step 1 |
| .fsl corrupted | Delete + re-init (data loss acceptable for snapshot) |

## Acceptance Criteria

- [ ] Init succeeds in fresh directory (no .git, no .fsl)
- [ ] Init succeeds in existing project (with .git)
- [ ] Re-init after user deletes .fsl
- [ ] No files tracked before ignore-glob is set
- [ ] Concurrent init attempts don't corrupt repo
