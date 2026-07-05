# Fossil Snapshot System

Real-time working copy tracking with undo/redo and session-level rollback.

## Architecture

- **Backend**: Fossil SCM (single `.fsl` file, 20+ years stable, portable)
- **Repo location**: `{data}/fossil/{projectID}/snapshot.fsl`
- **Checkout marker**: `_FOSSIL_` in worktree root (Windows)
- **Binary**: `external/fossil/fossil.exe` (v2.28)

## Key Design Decisions

1. **No colocated mode** — Fossil/jj must NOT share `.git` with the project
2. **Self-healing initialization** — if `.fsl` or data deleted, auto-recreate
3. **`.gitignore` respected** — translated to Fossil `ignore-glob` patterns
4. **Performance safe** — no scanning 5000+ files per operation
5. **`fossil checkout <hash>`** for rollback (not `fossil update` which preserves local changes)

## Commands Used

| Operation | Fossil Command |
|-----------|----------------|
| Init | `fossil init` |
| Open | `fossil open --keep` |
| Track file | `fossil add` |
| Commit | `fossil commit` |
| Diff | `fossil diff --from <hash> --to <hash> -s` |
| Diff status | `fossil diff --from <hash> --to <hash> --brief` |
| Log | `fossil timeline --limit N --format "%H" --reverse` |
| Info | `fossil info <hash>` |
| Revert | `fossil checkout <hash>` |

## File Structure

```
packages/opencode/src/snapshot/
├── fossil.ts          # Fossil snapshot backend (active)
├── index.ts           # Git snapshot backend (fallback)
├── jj.ts              # jj snapshot backend (dormant)
└── snapshot.sql.ts    # Database schema
```

## Key Functions

### `track(files?: string[])`
- Creates snapshot of current working copy
- Uses `fossil add` for new files, `fossil commit` for changes
- Returns hash of new commit

### `diffFull(from, to)`
- Returns file-level diffs between two commits
- Uses `fossil diff -s` for numstat, `--brief` for status
- Handles old git hashes via `resolveHash` fallback

### `resolveHash(hash)`
- Validates hash exists in fossil repo
- Falls back to earliest fossil commit for old git hashes
- Uses `fossil info <hash>` to check existence

### `restore(hash)`
- Restores working copy to specific commit
- Uses `fossil checkout <hash>`

## Configuration

In `opencode.json`:
```json
{
  "snapshot": {
    "auto-track": "none()",
    "ignore-glob": [".git", "node_modules", ".opencode"]
  }
}
```

## Integration Points

- **Session processor**: Tracks changed files from tool results
- **Summary system**: Computes diffs for "Modified Files" display
- **TUI indicator**: Shows fossil (green `●`) / jj (blue) / git (red)
- **Undo/redo**: Uses `restore()` to revert to specific commits

## Troubleshooting

### "Modified Files" shows 0 diffs
- Check logs for `resolveHash` fallback warnings
- Verify `fossil info <hash>` works for stored hashes
- Ensure `fossil timeline` returns commits

### Fossil binary not found
- Check `external/fossil/fossil.exe` exists
- Verify PATH includes fossil location
- Check `process.execPath` directory

### Performance issues
- Ensure `snapshot.auto-track = "none()"`
- Check `.gitignore` patterns are translated correctly
- Verify no full working copy scans on each operation

## Stable Version

This fossil snapshot system is stable as of commit `e490fa64f` (2026-07-05).

Key fixes included:
- Removed jj-specific `--ignore-working-copy` flag
- Changed `fossil log` to `fossil timeline` (correct command)
- Added `resolveHash` fallback for old git hashes
- Added `filediff` metadata to write tool
- Fixed path normalization for Windows compatibility
