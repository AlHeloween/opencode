# Per-Project SQLite Database

## Problem

All opencode data lives in a single global SQLite database at `~/.local/share/opencode/opencode.db`. This database grows rapidly (several GB) because `message`, `part`, and `event` tables accumulate all conversation history across all projects. The large file causes serious performance degradation — slow queries, long WAL checkpoints, and I/O contention.

## Solution

Split into **two database tiers**: a lightweight global DB for cross-project state, plus per-project DBs (`.opencode/project.db`) for all session-scoped data. This isolates growth to individual projects, keeps the global DB small (~MB), and enables per-project cleanup.

### Database Split

#### Global DB (`~/.local/share/opencode/opencode.db`) — stays small

| Table | Reason to keep global |
|-------|----------------------|
| `project` | Project registry — dozens of rows, referenced by session_index |
| `account` | Auth tokens — handful of rows, shared across projects |
| `account_state` | Active account/org — single row |
| `control_account` | Legacy — deprecated, tiny |
| `event_sequence` | Sync sequence numbers — needed for cross-project workspace sync fence |
| `session_index` | Lightweight session catalogue: `id`, `project_id`, `directory`, `title`, `parent_id`, `workspace_id`, `time_created`, `time_updated`, `time_archived` — enables global session listing without joining heavy tables |

#### Project DB (`.opencode/project.db`) — per worktree

| Table | Origin | Growth factor |
|-------|--------|---------------|
| `session` | Full session metadata | Linear per conversation |
| `message` | All assistant/user messages | **Primary growth driver** (100s-1000s per session) |
| `part` | All message parts (text, tool, file, etc.) | **Primary growth driver** (1000s-10000s per session) |
| `part_fts` | FTS5 virtual table on parts | Mirrors part table size |
| `todo` | Per-session todo items | Small |
| `session_entry` | Structured session log entries | Moderate growth |
| `session_share` | Share URLs per session | Tiny |
| `permission` | Permission ruleset per project | Single row per project |
| `workspace` | Workspaces for this project | Small |
| `event` | Sync event journal | Matches message+part growth |

### Database Resolution

Project DB path: `{worktree}/.opencode/project.db`

The global DB path does not change.

A new `DbInstance` service manages DB client lifecycle:
```ts
interface DbInstance {
  global(): Effect<DrizzleClient>         // singleton global DB
  project(projectID: string): Effect<DrizzleClient>  // lazy-init per-project DB
}
```

Project DB clients are cached by project ID. On project close/dispose, the project DB connection is closed.

### Migration: Auto-Migrate on Startup

**Trigger:** When the global DB has `project`-scoped data (checked via row count in `session` or `message` tables), auto-migration kicks in.

**Process:**
1. Mark the global DB as `migrating` (write a flag to prevent concurrent migrations)
2. For each `project` row:
   a. Create `.opencode/project.db` if not exists
   b. Run Drizzle migrations on it (create all project-scoped tables + FTS)
   c. Copy rows from global DB tables filtered by `project_id`
   d. Verify row counts match between source and destination
3. Drop project-scoped tables from global DB (or mark them as migrated)
4. Create `session_index` table in global DB from remaining session metadata
5. Write migration completion marker

**Error handling:** If migration fails mid-way, retry on next startup. Copied data remains in global DB until verified; no data loss.

**Migration can be skipped** via `OPENCODE_SKIP_PROJECT_DB_MIGRATION` flag (for CI/testing).

### Implementation Steps

#### Step 1: Split schema definitions

- Move project-scoped table definitions into `src/storage/schema-project.sql.ts`
- Keep global table definitions in `src/storage/schema.sql.ts`
- Add `session_index` table to global schema
- Update foreign key references: `session.project_id` → `project.id` crosses databases, so the FK becomes an application-level constraint (not a database-level FK)

#### Step 2: Refactor database layer (`src/storage/db.ts`)

- Extract `createClient(path)` from current singleton pattern
- Add `initGlobal()` — opens/creates global DB at `Global.Path.data/opencode.db`
- Add `initProject(projectID: string)` — opens/creates project DB at `{project.worktree}/.opencode/project.db`
- PRAGMA settings applied identically to both
- Migrations applied independently (separate migration folders: `migration-global/` and `migration-project/`)

#### Step 3: Create `DbInstance` service

New file: `src/storage/db-instance.ts`

```ts
export class DbInstance extends Context.Service<DbInstance, Interface>()("@opencode/DbInstance") {}
```

Provides `global()` and `project(projectID)` accessors with connection caching.

#### Step 4: Build migration runner

New file: `src/storage/project-db-migration.ts`

Functions:
- `needsMigration()` — checks if global DB still has project-scoped data
- `migrateAll()` — copies data per project, with progress reporting
- `cleanupGlobal()` — drops migrated tables from global DB
- `buildSessionIndex()` — populates `session_index` from migrated session rows

#### Step 5: Update all query access points

Every file that queries a project-scoped table must now route through the project DB:

| File | Tables queried | Change |
|------|---------------|--------|
| `src/session/session.ts` | `session` | Use `db.project(session.project_id)` |
| `src/session/message-v2.ts` | `message`, `part`, `part_fts` | Use `db.project(session.project_id)` |
| `src/session/projectors.ts` | `session`, `message`, `part` | Resolve project_id from session |
| `src/session/todo.ts` | `todo` | Use `db.project(...)` |
| `src/share/share-next.ts` | `session_share` | Use `db.project(...)` |
| `src/permission/index.ts` | `permission` | Already has `ctx.project.id` |
| `src/control-plane/workspace.ts` | `workspace`, `event`, `event_sequence` | Use `db.project(project.id)`; `event_sequence` stays global |
| `src/sync/index.ts` | `event`, `event_sequence` | Route by aggregate ID → session → project |
| `src/server/projectors.ts` | `session` | Resolve project_id |
| `src/server/fence.ts` | `event_sequence` | Stays global |
| `src/project/project.ts` | `project` | Stays global |
| `src/account/repo.ts` | `account`, `account_state` | Stay global |

#### Step 6: Handle cross-database concerns

**global session listing** — Queries `session_index` in global DB, joins with `project` table if needed. Full session details are fetched from the project DB only when needed.

**FTS search** — Scoped to current project's DB. No cross-project search needed (confirmed).

**Workspace sync** — `event_sequence` stays in global DB for cross-project sync fence. `event` journal moves to project DB. The sync coordinator iterates project DBs.

**Session cleanup/archive** — Nothing changes; project DB is deleted when the project is removed.

#### Step 7: Migration tests

- Test auto-migration on empty global DB (should no-op)
- Test auto-migration with data in one project
- Test auto-migration with data in multiple projects
- Test that data is correctly copied (same row counts, same content)
- Test that global DB is cleaned up after migration
- Test that `session_index` is correctly populated
- Test that idempotency: running migration twice is safe
- Test that new projects get empty project DBs on creation

#### Step 8: Backward compatibility

The global DB format changes significantly. However:
- The migration is automatic and happens on first startup after upgrade
- Data is preserved (copied, not moved, then verified)
- A `OPENCODE_SKIP_PROJECT_DB_MIGRATION` flag allows skipping for testing
- The old JSON migration layer (`JsonMigration`) is unaffected — it only runs when `opencode.db` doesn't exist

#### Step 9: Cleanup considerations

- Deleting a project (via `Project.Service.remove`) should close and delete the project DB
- The `.opencode/` directory containing `project.db` may need `.gitignore` treatment
- The existing `.opencode/` gitignore entry likely already covers `*.db` or should be updated

### Files Changed

| File | Change |
|------|--------|
| `src/storage/schema.sql.ts` | Keep only global tables; add `session_index` |
| `src/storage/schema-project.sql.ts` | **New** — project-scoped table definitions |
| `src/storage/db.ts` | Refactor from singleton to multi-instance; add `initProject()` |
| `src/storage/db-instance.ts` | **New** — DbInstance service with global/project accessors |
| `src/storage/project-db-migration.ts` | **New** — auto-migration runner |
| `src/session/*.ts` | Route queries to project DB |
| `src/project/project.ts` | Trigger project DB creation on project init |
| `src/permission/index.ts` | Route queries to project DB |
| `src/share/*.ts` | Route queries to project DB |
| `src/control-plane/workspace.ts` | Route queries to project DB |
| `src/sync/index.ts` | Route event queries to project DB |
| `src/index.ts` | Call auto-migration on startup |
| `drizzle.config.ts` | Add project schema config (or separate config) |
| `migration/` | Add project-specific migrations |

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Data loss during auto-migration | Copy-first, then verify, then drop. Retry on failure |
| Cross-DB foreign keys break | Drop `session.project_id` FK constraint, validate at app level |
| Migration takes too long for large DBs | Show progress bar, run in background with read fallback to global DB |
| Project DB path conflicts | Use project ID + worktree path, handle moves |
| Event sourcing events span projects | `event_sequence` stays global for cross-project coordinator |

### Migration estimate

| Task | Effort |
|------|--------|
| Split schema definitions | Small (2 files → 3 files) |
| Refactor db.ts | Medium (extract singleton pattern) |
| Create DbInstance service | Small |
| Build migration runner | Medium (copy/verify/delete logic) |
| Update query access points | Large (20+ files, 50+ query sites) |
| Tests | Medium (integration tests for migration) |
| **Total** | **~3-4 days** |
