# Per-Project DB: Remaining Items

## Resolved (done)

All core infrastructure, query routing, and tests are complete.

| # | Commit | What |
|---|--------|------|
| 1 | `721582b` | Schema split, multi-instance db.ts, migration SQL, migration runner |
| 2 | `1fe7d2d` | Sync routing, session query functions, projectors dual-write session_index |
| 3 | `8b8bac9` | Compile fixes, simplified migration runner |
| 4 | `090348d` | Shared `project-db.ts` utility, all 7 services route to project DB |
| 5 | `7b519bd` | Migration trigger in `index.ts`, `event_sequence` in project migration, `replay()` routing |
| 6 | `7e9fa7f` | Remaining call sites: stats, import, tui |
| 7 | `8a196ca` | `getPart()` routing fix |
| 8 | `97ca906` | session-entry routing, migration runner Drizzle compat, 4 integration tests |

## Remaining

### 1. Sync routes — cross-project `EventTable` queries

**Files:** `src/server/routes/instance/sync.ts:145`, `src/server/routes/instance/httpapi/sync.ts:118`

Query `EventTable` (project-scoped after migration) without project context. These are used for workspace sync (`OPENCODE_EXPERIMENTAL_WORKSPACES`). Post-migration, `event` rows live in project DBs.

**Fix:** Iterate project DBs or add project context from workspace/session lookup. Deferred — feature-flagged and experimental.

**Effort:** Medium

---

### 2. DrizzleKit config for project DB

`migration-project/` uses hand-written SQL. A `drizzle-project.config.ts` would enable `bun run db generate` for project migrations.

**Fix:** Add `drizzle-project.config.ts` referencing `schema-project.sql.ts` → `migration-project/`.

**Effort:** Small

---

## Non-issues (false positives)

| File | Why OK |
|------|--------|
| `fence.ts` | Queries `event_sequence` (global DB) |
| `account/repo.ts` | Queries `account`/`account_state` (global DB) |
| `project/project.ts` | Queries `ProjectTable` (global DB) |
| `worktree/index.ts` | Queries `ProjectTable` (global DB) |
| `sync/index.ts:139` | Queries `session_index` (global DB) |
| `sync/index.ts:184` | Writes `event_sequence` to global DB |
| `session/projectors.ts` | `Database.use` for `session_index` (global DB) |
| `session/message-v2.ts:1231` | Queries `ProjectTable` for worktree lookup (global DB) |
| `session/session.ts:438` | `resolveSessionProject` queries `session_index` (global DB) |
