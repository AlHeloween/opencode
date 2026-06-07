# Eliminate Exe-Adjacent Global Database

**Status:** draft
**Created:** 2026-06-04
**Goal:** Remove the exe-adjacent global database entirely. All data lives in the project database at `{worktree}/.opencode/data/opencode.db`. No database file exists alongside the executable.

## Root Cause

`Global.Path.data` defaults to `{exeDir}/.opencode/data` before any worktree is known (line 11 of `global.ts`). This creates a global DB at `{exeDir}/.opencode/data/opencode.db` that's used during bootstrap. When `initFromWorktree(worktree)` runs, it redirects `Global.Path.data` to `{worktree}/.opencode/data` — effectively making the global DB the same file as the project DB.

When `exeDir === worktree`, the paths were already the same, so two independent SQLite connections (`defaultDb` + `projectClients`) opened to one file, causing corruption.

**The fix isn't to deduplicate connections — it's to eliminate the exe-adjacent DB entirely.** There should be no database file alongside the executable. All project-scoped data belongs in the project DB. Auth belongs in `auth.json` (which already exists alongside the exe).

## Current Architecture (broken)

```
Phase 1 (pre-worktree):
  Global.Path.data = {exeDir}/.opencode/data
  getDefaultDb() → {exeDir}/.opencode/data/opencode.db   ← exe-adjacent DB

Phase 2 (post-worktree):
  Global.initFromWorktree(worktree)
  Global.Path.data = {worktree}/.opencode/data
  getDefaultDb() → {worktree}/.opencode/data/opencode.db   ← SAME AS PROJECT DB!
  getProjectDb() → {worktree}/.opencode/data/opencode.db   ← SAME FILE, different connection!
```

## Corrected Architecture

```
Always:
  Global.Path.data = starts UNDEFINED (no exe-adjacent path)
  Global.initFromWorktree(worktree) → sets Global.Path.data = {worktree}/.opencode/data
  getDefaultDb() → {worktree}/.opencode/data/opencode.db   ← the one and only DB
  getProjectDb() → {worktree}/.opencode/data/opencode.db   ← SAME connection, no collision

Before worktree is known:
  Database.use() without Instance context → in-memory transient DB or explicit error
  Auth reads → from auth.json only (no DB needed)
  Project discovery → filesystem scan, no DB needed
```

## What the Global DB Actually Stores (irrelevant!)

The exe-adjacent global DB stores:
1. `account` / `account_state` — but auth.json ALREADY has the full auth data
2. `project` table — a registry of known projects, but this is synced to the worktree DB via `importFromDisk()`
3. All other tables — SAME schema as project DB, but never used outside project context

**None of this data needs the exe-adjacent DB.** Auth is in auth.json. Project registry can be rebuilt from filesystem (`fromDirectory()` already does this).

## Tasks

### Task 1: Remove exe-adjacent default from global.ts

**File:** `packages/core/src/global.ts` lines 11, 16, 26, 43-45

- [ ] Remove `_data = path.join(_config, ".opencode", "data")` default
- [ ] `_data` starts empty/undefined until `initFromWorktree()` sets it
- [ ] `get data()` returns `_data` (may be empty before init)
- [ ] Remove the assumption that `Path.data` is always set — callers must check

### Task 2: Make getDefaultDbPath() worktree-scoped only

**File:** `packages/opencode/src/storage/db.ts` lines 21-27, 40-46

- [ ] `getDefaultDbPath()`: if `Global.Path.data` is not set, throw or return undefined
- [ ] `getDefaultDb()`: if no path available, create an in-memory SQLite DB (`:memory:`) as transient fallback during bootstrap
- [ ] OR: simply throw with a clear error — "no worktree initialized"

### Task 3: Fix bootstrap to work without global DB

**File:** `packages/opencode/src/project/instance.ts` lines 27-52

- [ ] `fromDirectory()` must not require DB access — it does filesystem-only discovery
- [ ] If `fromDirectory()` currently reads `project` table from global DB, change to filesystem scan
- [ ] `syncUpsert()` must work without pre-existing DB (it creates the DB)
- [ ] After `initFromWorktree()`, the DB at worktree is available for all subsequent operations

### Task 4: Audit Database.use() callers for pre-worktree access

**File:** all 22 `Database.use()` call sites

- [ ] Audit each call: does it run before `initFromWorktree()`?
- [ ] For calls in auth/account code: redirect to auth.json only
- [ ] For calls in project discovery: use in-memory DB or filesystem
- [ ] For calls in session/workspace: require Instance context (already satisfied)

### Task 5: Handle account/auth — ensure deferred until after boot

**File:** `packages/opencode/src/account/repo.ts`

**Key correction:** `auth.json` stores **provider credentials** (API keys), NOT account data. The `AccountRepo` uses `account`/`account_state` DB tables for opencode account management. These tables exist in every project DB (same `CORE_SCHEMA_SQL`).

- [ ] Verify no `AccountRepo` operations run before `initFromWorktree()` is called
- [ ] If account ops DO run pre-boot, defer them until the worktree DB is available
- [ ] After boot, `Database.use()` fallback goes to the worktree DB, so account data in the worktree DB is accessible
- [ ] No migration needed — account tables exist in all project DBs from the same schema

### Task 6: Remove unused tables from CORE_SCHEMA_SQL

**File:** `packages/opencode/src/storage/db.ts`

- [ ] Optionally remove `account`/`account_state` from CORE_SCHEMA_SQL (cleanup only, not required for fix)
- [ ] These tables can remain in project DBs (backward compat), just not in a separate global DB

### Task 7: Remove the two-connection architecture

**File:** `packages/opencode/src/storage/db.ts` lines 337-346, 30-46

- [ ] After Task 1-2, `getDefaultDb()` and `getProjectDb()` always resolve to the same file
- [ ] Simplify: merge `defaultDb` and `projectClients` cache into one
- [ ] `getProjectDb()` becomes the primary entry point; `getDefaultDb()` delegates to it
- [ ] OR: remove `getDefaultDb()` entirely, replace all callers with `getProjectDb()`

### Task 8: Verify no regression

- [ ] `bun typecheck`
- [ ] Run full test suite
- [ ] Test: start opencode from any directory, open a project, verify no errors
- [ ] Test: opencode.exe in project root — no corruption, one DB connection
- [ ] Test: existing projects with data in worktree DB — all data intact

## Non-Goals

- Do not change the portable path architecture (`Global.Path.config` stays exe-adjacent for auth.json)
- Do not change the auth.json format or location
- Do not change the project DB schema — tables stay the same
- Do not remove `account`/`account_state` tables (they exist in worktree DBs from before)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Pre-worktree code that reads `project` registry from global DB | Change to filesystem-based discovery |
| Auth reads that depend on `account` DB table | Auth.json already has full data; no DB needed |
| Existing worktree DBs missing `account` table | Table already exists in all worktree DBs (same CORE_SCHEMA_SQL) |
| `listAll()` session enumeration across projects | Already iterates filesystem to find project DBs; no global DB needed |
