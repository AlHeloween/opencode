# Snapshot Rollback (Undo) — Architecture & Performance

## How Undo Works

```
User presses Ctrl+X, U
  │
  ▼
TUI: sdk.client.session.revert({ sessionID, messageID })
  │
  ▼
Server: SessionRevert.revert()
  │
  ├─ 1. assertNotBusy()           ── check session not running
  │
  ├─ 2. sessions.messages()       ── load all messages from DB
  │     find target message + collect patches from prior messages
  │
  ├─ 3. snap.track()              ── SNAPSHOT CURRENT STATE (expensive)
  │     │
  │     ├─ git diff-files         ── find modified files
  │     ├─ git ls-files --others  ── find untracked files       ← parallel
  │     ├─ git check-ignore       ── filter ignored files
  │     ├─ fs.stat × N            ── find files > 2MB (exclude) ← concurrency: 8
  │     ├─ git rm --cached        ── remove newly-ignored       ← chunked
  │     ├─ git add --all --sparse ── stage everything            ← chunked
  │     └─ git write-tree         ── produce tree hash
  │
  ├─ 4. snap.restore(snapshot)    ── RESTORE PREVIOUS SNAPSHOT
  │     │
  │     ├─ git read-tree <hash>   ── load tree into index
  │     └─ git checkout-index -a  ── overwrite working files
  │
  ├─ 5. snap.revert(patches)      ── APPLY PATCHES (per-file git ops)
  │     │
  │     └─ for each patch file:
  │        ├─ git ls-tree         ── check if file existed in snapshot
  │        ├─ git checkout <hash> ── restore file from snapshot
  │        └─ fs.remove           ── OR delete if file didn't exist
  │        (batched up to 100 files per git call when paths don't clash)
  │
  ├─ 6. snap.diff(snapshot)       ── COMPUTE DIFF
  │     │
  │     ├─ git diff-files         ── find modified files
  │     ├─ git ls-files --others  ── find untracked files       ← parallel
  │     ├─ git check-ignore       ── filter ignored files
  │     ├─ git add --all --sparse ── stage for diff              ← chunked
  │     └─ git diff --cached      ── produce diff output
  │
  ├─ 7. summary.computeDiff()     ── compute per-file diff stats
  │
  └─ 8. storage.write + bus.publish + sessions.setRevert
```

## Why It's Slow

| Phase | Git Processes | Bottleneck |
|-------|:------------:|------------|
| `snap.track()` | 5-7 | Full working-dir scan: diff-files + ls-files + check-ignore + stat(N) + stage + write-tree |
| `snap.restore()` | 2 | read-tree + checkout-index (fast) |
| `snap.revert()` | 2+ per file | Per-file checkout/ls-tree; batching helps but still O(files) spawns |
| `snap.diff()` | 5-7 | Another full working-dir scan + stage + diff |
| **Total** | **~20-30+** | Each spawn = fork + exec git + IPC + wait |

### Key bottlenecks

1. **Process spawn overhead**: Every `git` call spawns a new process (~10-50ms each on Windows). With 20-30 calls, that's 200-1500ms just in spawn overhead.

2. **`track()` scans the entire working directory**: `git diff-files` and `git ls-files --others` on a large repo (thousands of files) is slow, even with `--sparse`.

3. **`revert()` does per-file git operations**: Even with batching (100 files/batch), each batch spawns 2 git processes (ls-tree + checkout). 500 files = 10+ spawns.

4. **Double directory scan**: `track()` scans the working dir, then `diff()` scans it again. These could potentially be merged.

5. **Sequential phases**: All 6 phases run sequentially under a single semaphore lock.

## What Could Be Faster

| Optimization | Impact | Complexity |
|-------------|--------|------------|
| Use `git status --porcelain` instead of separate diff-files + ls-files | Saves 1 spawn per scan | Low |
| Merge `track()` + `diff()` into one pass | Saves ~5-7 spawns | Medium |
| Use `git checkout <hash> -- .` instead of per-file checkout | Single spawn for all files | Low |
| Batch `git add` more aggressively (use stdin pathspec) | Fewer chunk spawns | Medium |
| Use `git sparse-checkout` instead of `--sparse` flag | Better for large repos | High |
| Cache file-list between operations | Avoid redundant scans | Medium |
