# Research Task: jj (Jujutsu) Integration for Real-Time Snapshot System

## Goal

Replace the current git-based snapshot system (`src/snapshot/index.ts`) with jj (Jujutsu VCS) as a standalone, git-independent working copy tracker. jj provides automatic snapshots, full operation log with undo/redo, and differential rollback — all superior to the current git bare-repo approach.

## Constraints (HARD)

1. **NO colocated mode.** jj must NOT share `.git` with the project. jj and git are completely independent systems.
2. **NO modifications to the project's `.git/`.** jj must not touch, reference, or interfere with the existing git repository.
3. **Self-healing initialization.** If `.jj/` or the jj data directory is deleted by the user, it must be recreated automatically on next use. Never report a missing jj repo as an error.
4. **Must respect `.gitignore`.** jj must not track files that are gitignored (node_modules, build artifacts, SDK distributions like wasi-sdk, etc.).
5. **Performance safe.** jj must not scan or list thousands of files on every operation. The worktree has ~5000+ files. Any approach that causes jj to enumerate all files on every command is unacceptable.
6. **Windows compatible.** Must work on Windows (cmd.exe/PowerShell). jj 0.28.0 is installed at `C:\Windows\jj.exe`.

## What We Know (Verified Facts)

1. **jj 0.28.0 is installed** and works on this system.
2. **`jj git init <destination>`** creates a standalone repo with its own git backend inside `.jj/`. No connection to project's `.git/`.
3. **`jj git init --git-repo <path>`** creates `.jj/` in the current directory using an external git repo as backend. This DID work — jj could see worktree files.
4. **`jj git init` refuses to run** in a directory that already has `.git/` (unless `--colocate`).
5. **`jj workspace add <path>` fails** when the target path is an ancestor of the jj repo directory ("Workspace already exists" error).
6. **`snapshot.auto-track` defaults to `all()`** — this causes jj to scan ALL files. Must be set to `none()` BEFORE any operation.
7. **`--config` flag during `jj git init` is IGNORED** in jj 0.28. Config must be set via `jj config set --repo` after init.
8. **jj respects `.gitignore`** from the working copy directory. BUT if jj's backend is standalone (not colocated), it may not automatically find the project's `.gitignore`.
9. **jj status lists ALL untracked files** — even with `auto-track = "none()"`, `jj status` shows every file in the worktree. This caused system paralysis when run on the full worktree.

## Architecture Context

### Current Snapshot System (`src/snapshot/index.ts`)
- Uses a bare git repo at `{worktree}/.opencode/data/snapshot/{projectID}/{hash}/`
- `track()`: stages files via `git add`, returns tree hash via `git write-tree`
- `restore(hash)`: `git read-tree` + `git checkout-index -a -f`
- `revert(patches)`: `git checkout <hash> -- <file>` per file
- Captures: before LLM stream (`processor.ts:177`) + at finish-step (`processor.ts:570`)
- Tree hashes stored in DB parts (step-start, step-finish)
- Cleanup: `git gc --prune=7.days` every hour

### Current Backup System (`src/tool/edit.ts`)
- Creates `.bak` files at `{data}/backups/{sessionID}/`
- MAX 50 per session, oldest pruned
- **NEW FIX (just committed):** `git check-ignore` guard skips backup for gitignored files
- Independent from snapshot system

### DB Schema (`session.sql.ts`)
- `session.revert` column: `{ messageID, partID, snapshot?, diff?, conflicts? }`
- `session.summary_diffs`: `Snapshot.FileDiff[]`
- Parts store tree hashes in `step-start` and `step-finish` part types

## Research Questions

1. **Workspace approach**: How to safely create a jj workspace pointing at the worktree from a repo stored OUTSIDE the worktree (e.g., `{data}/jj/{projectID}/`)? Is there a way to avoid the "Workspace already exists" error when the worktree is an ancestor of the repo?

2. **File scanning performance**: How to prevent jj from scanning the entire worktree on every command? Is `snapshot.auto-track = "none()"` sufficient, or does jj still enumerate files? What about `--ignore-working-copy`?

3. **`.gitignore` inheritance**: In standalone mode, how does jj find `.gitignore` files? Does it look in the working copy directory? Does it need a separate `.gitignore`? Can we symlink or copy the project's `.gitignore`?

4. **Operation log for session isolation**: Can we use `jj op log` + `jj op restore` for per-session rollback? How do concurrent sessions interact with the operation log?

5. **`jj restore` vs `jj op restore`**: Which is correct for reverting file changes? `jj restore --from <change> -- <files>` or `jj op restore <op_id>`?

6. **Integration points**: Where exactly should jj snapshot calls replace the current `git write-tree` calls? Same call sites in `processor.ts`?

7. **Cleanup**: How to manage jj's operation log growth? `jj operation abandon`? What's the equivalent of `git gc --prune=7.days`?

8. **Risk assessment**: What are the failure modes? Can jj corrupt the worktree? Can `jj undo` lose data? What happens if jj is killed mid-operation?

## Deliverable

A written report with:
1. **Safe initialization sequence** (exact commands, tested on this system)
2. **Configuration** (exact config values needed)
3. **Integration plan** (which files to modify, what to replace)
4. **Risk mitigation** (failure modes and how to handle them)
5. **Proof of concept** (minimal test: init → track file → undo → verify files intact)

## Testing Approach

All tests must be done on a SMALL subdirectory first (e.g., `plans/` or a temp directory), NOT the full worktree. Only after proving safety on small scope should full worktree be attempted.

## Files to Read

- `packages/opencode/src/snapshot/index.ts` — current snapshot module (796 lines)
- `packages/opencode/src/session/processor.ts` — where track() is called (lines 177, 570)
- `packages/opencode/src/session/revert.ts` — revert/unrevert logic
- `packages/opencode/src/session/session.sql.ts` — DB schema
- `packages/opencode/src/tool/edit.ts` — edit tool with backup system
- `.opencode/skills/jj-vcs/SKILL.md` — draft skill file (needs updating based on research)
