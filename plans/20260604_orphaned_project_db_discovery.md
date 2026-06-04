# Orphaned Project Database Discovery & Indexing

## Goal

When opencode is launched, it must detect pre-existing `.opencode/data/opencode.db` files — even if not yet registered in the current global index — validate them, and add them to the index so sessions from all known projects can be listed and restored.

## Root Cause

Two bugs work together:

1. **Ordering bug in `boot()`** (`project/instance.ts:27-50`): `fromDirectory()` writes project registration to `{exeDir}/.opencode/data/opencode.db` (the default DB BEFORE `Global.initFromWorktree`). Then `initFromWorktree` changes the default DB to `{worktree}/.opencode/data/opencode.db`. The project registration is in the WRONG file — `listGlobal()` reads from the new DB and finds zero projects.

2. **Missing orphaned DB scanner**: No code exists to scan the filesystem for `.opencode/data/opencode.db` files and import their project metadata into the global index.

## Implementation

### Task 1: Fix boot() ordering — re-register project after initFromWorktree

- **File**: `packages/opencode/src/project/instance.ts`
- Add `Project.syncUpsert(ctx.project)` call after `Global.initFromWorktree(ctx.worktree)`

### Task 2: Add `infoToValues` helper + `syncUpsert` to project.ts

- **File**: `packages/opencode/src/project/project.ts`
- Add `infoToValues(info)` — converts `Info` to `ProjectTable` insert values
- Add `syncUpsert(info)` — upserts an `Info` into the current default DB
- Refactor `fromDirectory` to use `infoToValues` (DRY)
- Re-export `syncUpsert` for use in `instance.ts`

### Task 3: Add `importFromDisk(worktree)` to project.ts

- **File**: `packages/opencode/src/project/project.ts`
- Checks if `{worktree}/.opencode/data/opencode.db` exists
- Opens it with `init()`, validates it has `project` + `session` tables
- Reads project metadata, calls `syncUpsert()` to import into global index
- Closes the temporary DB connection
- Returns `Info | undefined`

### Task 4: Call `importFromDisk` from `fromDirectory`

- **File**: `packages/opencode/src/project/project.ts`
- After existing upsert, call `importFromDisk(data.worktree)`
- Ensures per-project DB is indexed even if not previously registered

### Task 5: Auto-discover orphaned projects in `listGlobal()`

- **File**: `packages/opencode/src/session/session.ts`
- After reading projects from global DB, scan parent directories of each known project's worktree
- For each sibling directory with `.opencode/data/opencode.db`, call `Project.importFromDisk()`
- Append discovered projects to the iteration list

### Task 6: Add tests

- **File**: `packages/opencode/test/` (TBD)
- Test `importFromDisk` with a valid and invalid DB
- Test `syncUpsert` idempotency
- Test `listGlobal` auto-discovery of sibling projects
