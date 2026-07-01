---
status: active
owner: codex
created: 2026-06-29
reproduce:
  - D:\zPython\opencode\tools\jj.exe --version
  - cd packages/opencode && bun test test/snapshot/
---

# jj Snapshot — Git Plumbing Replacement

## Goal

Replace git plumbing in `src/snapshot/index.ts` with jj (Jujutsu) for session turn snapshots. Git stays for real commits. jj eliminates Windows file lock contention (index.lock, msys2) that corrupts the git dir when spawning hundreds of git processes per session.

## Math

```
Old: git add -A → git write-tree → hash string
     O(n) process spawns per turn, each risks index.lock contention

New: jj describe -m "snapshot" → change ID
     O(1) in-process, no index.lock, no msys2 overhead
```

## Files

| File | Change |
|------|--------|
| `tools/jj.exe` | Created — jj v0.28.0 Windows binary |
| `experiments/20260629_jj_smoke.ts` | Created — smoke tests |
| `packages/opencode/src/snapshot/index.ts` | Modified — git plumbing → jj |
| `.gitignore` | Modified — add `.jj/` |

## Sub-Plans

### 1. Smoke Tests (`experiments/20260629_jj_smoke.ts`)

- [ ] Init jj repo in temp dir
- [ ] Create file, snapshot, get change ID
- [ ] Modify file, restore from snapshot, verify content reverted
- [ ] Delete file, restore from snapshot, verify file back
- [ ] Multiple files (100), snapshot, modify all, restore, verify
- [ ] Diff between two snapshots
- [ ] Cleanup temp dir

### 2. Snapshot Layer Rewrite (`packages/opencode/src/snapshot/index.ts`)

Git plumbing functions to replace:

| Function | Lines | git command | jj replacement |
|----------|-------|-------------|----------------|
| `track()` init | 301-309 | `git init`, config | `jj git init` (colocated) |
| `track()` snapshot | 311-314 | `git add` + `git write-tree` | `jj new --no-edit` → `jj log -r @- --no-graph -T 'change_id'` |
| `restore()` | 353-376 | `git read-tree` + `git checkout-index` | `jj restore --from <change>` |
| `revert()` per-file | 396-411 | `git checkout <hash> -- <file>` | `jj restore --from <hash> <file>` |
| `diff()` | 324-328 | `git diff --name-only <hash>` | `jj diff --summary --from <hash>` |
| `diffFull()` | 514+ | `git diff <from> <to>` | `jj diff --git --from <from> --to <to>` |
| `patch()` ls-tree | 434-438 | `git ls-tree --name-only` | parse `jj file list -r <hash>` |

- [ ] jj binary path resolution (use `tools/jj.exe` or PATH)
- [ ] Lock mechanism (jj is lock-free, remove git lock wrapper)
- [ ] All existing tests pass with jj backend
- [ ] Typecheck clean

### 3. Integration Tests

- [ ] Session revert restores files correctly
- [ ] Two consecutive snapshots, diff between them
- [ ] 100-file change batch revert
- [ ] Snapshot cleanup doesn't leak

## Risk

- **jj colocated with git**: `jj git init` in existing worktree wraps `.git/` — jj reads git objects but writes its own `.jj/` store. Zero migration.
- **jj not on PATH**: ship `tools/jj.exe`, resolve at runtime
- **jj output format**: uses templates, stable across versions

## Execution Order

```
1. Smoke tests (experiments/) — verify jj works on Windows
2. Snapshot rewrite — replace git plumbing
3. Integration — session revert tests
```
