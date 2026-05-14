**Validated by explore agent against actual codebase 2025-05-14. Corrections applied:**
- Reference count corrected: 128 (not 166) across 55 files
- Removed non-existent files: `shell/shell.ts`, `session/prompt.ts`
- Removed `file/ripgrep.ts` from temp section (uses `Global.Path.bin`, not `os.tmpdir()`)
- `session_index` impact expanded: 5 files affected, not 3
- 21 additional `Global.Path` reference files added to the modification list
- Env vars section expanded with actual enumeration from codebase

**User refinements 2025-05-14:**
- DB name: always `opencode.db` (no channel/version variants). Multiple opencode executables on different paths each have their own auth/config adjacent — this guarantees version isolation.
- Remove all backward migrations: `json-migration.ts`, `project-db-migration.ts`, legacy JSON storage (`storage.ts`). New software, clean break.

**Implementation correction 2026-05-14:**
- Runtime migration execution removed: startup no longer runs JSON→SQLite or global→project migration, `opencode db migrate` is removed, and `Storage.defaultLayer` no longer runs legacy JSON storage migrations.
- Deleted obsolete migration modules/tests: `storage/json-migration.ts`, `storage/project-db-migration.ts`, `test/storage/json-migration.test.ts`, and `test/storage/project-db-migration.test.ts`.
- `storage/storage.ts` remains only as the current JSON read/write service and `NotFoundError` owner for summary/revert/server paths; full deletion is still pending until those remaining consumers are replaced.

**BUGFIX 2026-05-14 — TUI crash (SQL logic error + blank/garbled output):**
- Observed: `opencode_v1` starts, shows logo + session info, then floods terminal with blank output before crashing with `SQLiteError: SQL logic error (errno: 1)` in an immediate transaction inside the Effect/Drizzle stack.
- Root causes traced via codebase analysis:
  1. `PROJECT_SCHEMA_SQL` (inline schema applied to per-project DBs) is **missing the `project` table** — `Project.fromDirectory()` writes to global DB for project registration, but per-project queries reference IDs that live only in the global DB.
  2. **Global DB singleton (`Client()`) still exists** with **14 call sites** in `src/` + **4 in test/**. Used as fallback in `Database.use()`/`Database.transaction()`/`sync/index.ts` (`writeGlobalSequence`)/`message-v2.ts` (`search()`). The architecture target is *no global DB* — all data per-project.
  3. **FTS/indexes are addons, not schema**: `verifyFTS()` and `maintainOnStartup()` run as separate startup hooks (called only from `Client()` init at `db.ts:77-78`). When the global DB is removed, these become dead code. The `PROJECT_SCHEMA_SQL` already defines FTS tables + triggers inline.
  4. **`auth.json` reads from `Global.Path.data`** (`auth/index.ts:10`, `mcp/auth.ts:32`, `providers.ts:228`) — should be executable-adjacent (`Global.Path.config`).

**Explore agent validation 2026-05-14 — corrections applied:**
- `lsp/server.ts:1270` does NOT use `os.tmpdir()` (already uses `Global.Path.data + "tmp"`). Only 3 actual `os.tmpdir()` usages remain.
- `getChannelPath()` already removed from codebase — removed from plan.
- `session_index` already removed from codebase — removed from plan.
- `storage/global.sql.ts` is already empty (1 blank line). Account tables are in `account/account.sql.ts`.
- `.gitignore` already has `.opencode/data` gitignored at repo root (line 37).
- `Global.Path` resolution in `global.ts` already implements worktree-relative paths after `initFromWorktree()`. Remaining work: auth.json file path references.
- **New finding**: `account` and `account_state` tables also missing from `PROJECT_SCHEMA_SQL` — must be added when eliminating global DB (`Database.Client()` currently serves them).
- `message-v2.ts:search()` has 4 global DB dependencies: `Database.Client()` at lines 1232, 1236, and `Database.rebuildFTS()` at line 1244.

---

## Goal

Redesign opencode's external file layout to be fully per-project (no global state) and document every path. Fix the critical TUI crash caused by global DB remnants and missing `project` table in per-project schema.

## Current vs Target Architecture

| Aspect | Current | Target |
|--------|---------|--------|
| Data root | `~/.local/share/opencode/` (xdg-basedir, shared across projects) | `{worktree}/.opencode/data/` (per-project, gitignored) |
| Config files | `~/.config/opencode/opencode.jsonc` | `{exeDir}/opencode.jsonc` (next to executable) |
| Auth | `~/.local/share/opencode/auth.json` | `{exeDir}/auth.json` (next to executable) |
| DB name | `opencode.db` or `opencode-{channel}.db` (per-channel) | Always `opencode.db` — no channel/version variants |
| Temp files | `os.tmpdir()` | `{worktree}/.opencode/data/tmp/` |
| Global DB | Yes (accounts, project listing, FTS verify) | **No** — fully per-project, no cross-project state |
| Per-project DB | `{worktree}/.opencode/project.db` | `{worktree}/.opencode/data/opencode.db` |
| Backward migrations | `json-migration.ts`, `project-db-migration.ts` | **Removed** — clean break |
| Legacy JSON storage | `storage/storage.ts` | Migration behavior removed; service deletion pending |
| FTS/healing | `verifyFTS()` + `maintainOnStartup()` startup hooks | Removed — FTS defined inline in `PROJECT_SCHEMA_SQL` |

---

## Implementation Tasks (priority-ordered)

### 0. [P0-CRITICAL] Fix PROJECT_SCHEMA_SQL — add missing tables
**File:** `packages/opencode/src/storage/db.ts`

The `PROJECT_SCHEMA_SQL` constant (lines 124-288) is the inline SQL that creates all tables in per-project databases. It currently defines 10 tables but is missing 2 critical tables that are queried by the application via `Database.use()`:

**Missing tables:**

**`project` table** (matches `project/project.sql.ts:5-17`):
```sql
CREATE TABLE IF NOT EXISTS "project" (
  id text PRIMARY KEY NOT NULL,
  worktree text NOT NULL,
  vcs text,
  name text,
  icon_url text,
  icon_url_override text,
  icon_color text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_initialized integer,
  sandboxes text NOT NULL DEFAULT '[]',
  commands text DEFAULT '{}'
);
```

**`account` table** (matches `account/account.sql.ts:6-14`):
```sql
CREATE TABLE IF NOT EXISTS "account" (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  url text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry integer,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
```

**`account_state` table** (matches `account/account.sql.ts:16-22`):
```sql
CREATE TABLE IF NOT EXISTS "account_state" (
  id integer PRIMARY KEY,
  active_account_id text,
  active_org_id text
);
```

Also verify column parity with all Drizzle `.sql.ts` files under `src/`.

### 1. [P0-CRITICAL] Eliminate global DB singleton (`Client()`)
**Files:** `storage/db.ts`, `sync/index.ts`, `session/message-v2.ts`, `storage/project-db.ts`

The global DB concept must be removed entirely. All data lives in the per-project DB at `{worktree}/.opencode/data/opencode.db`.

**14 call sites to remove/modify in `src/`:**

| # | File | Line | Current Code | Change |
|---|------|------|-------------|--------|
| 1 | `storage/db.ts` | 74-80 | `Client` lazy singleton definition | Remove entirely |
| 2 | `storage/db.ts` | 336 | `Client().$client.close()` | Remove (no global DB to close) |
| 3 | `storage/db.ts` | 337 | `Client.reset()` | Remove |
| 4 | `storage/db.ts` | 437 | `Client()` in `rebuildFTS()` | Remove entire `rebuildFTS()` function |
| 5 | `storage/db.ts` | 519 | `: Client()` fallback in `use()` | Always use project DB via `getProjectDb()` |
| 6 | `storage/db.ts` | 521 | `db = Client()` catch fallback | Remove — always use project DB |
| 7 | `storage/db.ts` | 536 | `: Client()` in `projectUse()` | Remove ternary |
| 8 | `storage/db.ts` | 571 | `: Client()` in `transaction()` | Always use project DB |
| 9 | `storage/db.ts` | 573 | `db = Client()` catch fallback | Remove |
| 10 | `storage/db.ts` | 598 | `: Client()` in `projectTransaction()` | Remove ternary |
| 11 | `sync/index.ts` | 169 | `writeSequence(Database.Client(), ...)` | Remove — sequence writes stay in project DB transaction |
| 12 | `sync/index.ts` | 173 | `Database.Client().delete(...)` | Remove — sequence deletes stay in project DB transaction |
| 13 | `session/message-v2.ts` | 1232 | `Database.Client().select().from(ProjectTable)...` | Use `Database.projectUse()` or pass worktree directly |
| 14 | `session/message-v2.ts` | 1236 | `: Database.Client().$client` fallback | Remove fallback — always use project DB |

**`sysnc/index.ts` changes (3 functions to update):**
- Remove `writeGlobalSequence()` function (line 168-170) + its 2 call sites (lines 206, 361)
- Remove `deleteGlobalSequence()` function (line 172-174) + its 1 call site (line 395)
- In `run()`, remove the `writeGlobalSequence(agg, sequence)` call after project transaction (line 361)
- In `process()`, remove `writeGlobalSequence(event.aggregateID, event.seq)` (line 206)
- In `remove()`, remove `deleteGlobalSequence(aggregateID)` (line 395)

**`message-v2.ts` `search()` fix (lines 1231-1292):**
Instead of querying `Database.Client()` for the project, pass `worktree` from the caller:
- Add `worktree` to the `search()` parameter type
- Replace `Database.Client()...get()` with `Database.projectUse(projectID, worktree, ...)`
- Remove `: Database.Client().$client` fallback branch
- Remove `Database.rebuildFTS()` call (line 1244) — FTS is defined inline, no need to verify

**`session/session.ts:841` update:**
- Pass `directory` (worktree) through to `MessageV2.search()` from `InstanceState.context`

**`storage/project-db.ts` changes:**
- `use()` line 8: Remove `!Database.usesProjectDb(ctx.worktree)` guard; always route to `Database.withProject()`
- `transaction()` line 17: Same

**Remove dead functions from `storage/db.ts`:**
- `verifyFTS()` (lines 363-434) — called only from `Client()` init, becomes dead code
- `maintainOnStartup()` (lines 453-492) — same
- `rebuildFTS()` (lines 436-451) — called from `message-v2.ts:1244`, also removed
- `FTS_BACKFILL_SQL` constant (lines 340-361)
- `usesProjectDb()` (line 21-23) — no longer needed since there's no conditional
- `close()` (lines 334-338) — only `closeAllProjectDbs()` remains
- `Path` export (lines 25-31) — simplified to always join with `Global.Path.data`

**Test files to update (4):**
- `test/storage/db.test.ts:49` — replace `Database.Client()` with `Database.getProjectDb()`
- `test/account/service.test.ts:23` — same
- `test/account/repo.test.ts:11` — same
- `test/server/httpapi-experimental.test.ts:115` — same

### 2. [P0] Fold FTS/indexes into DB definition (eliminate verifyFTS/maintainOnStartup addon)
**File:** `packages/opencode/src/storage/db.ts`

FTS and other indices must be part of the schema definition, not separate addon steps that verify/heal at startup. After Section 1 (removing `Client()`), the addon functions become dead code since they're only called from the global DB init.

- Remove `verifyFTS()` function entirely (lines 363-434)
- Remove `maintainOnStartup()` function entirely (lines 453-492)
- Remove `rebuildFTS()` export (lines 436-451)
- Remove `FTS_BACKFILL_SQL` constant (lines 340-361)
- `PROJECT_SCHEMA_SQL` already defines `part_fts` virtual table (line 233) + 3 triggers (lines 248-287)
- If `PRAGMA optimize` is needed, inline it into `createAndInitDb()` (no need for a separate function)

### 3. [P0] Move auth.json to executable-adjacent `Global.Path.config`
**Files:** `auth/index.ts`, `mcp/auth.ts`, `cli/cmd/providers.ts`

`Global.Path.config` is already correctly set to `exeDir` (next to executable) at `global.ts:17`. Only the file path references need updating:

| File | Line | Current | Change to |
|------|------|---------|-----------|
| `auth/index.ts` | 10 | `path.join(Global.Path.data, "auth.json")` | `path.join(Global.Path.config, "auth.json")` |
| `mcp/auth.ts` | 32 | `path.join(Global.Path.data, "mcp-auth.json")` | `path.join(Global.Path.config, "mcp-auth.json")` |
| `cli/cmd/providers.ts` | 228 | `path.join(Global.Path.data, "auth.json")` | `path.join(Global.Path.config, "auth.json")` |

The `.tst1/auth.json` is already placed next to the executable — the code just needs to match.

---

### 4. Fix `Global.Path` resolution (mostly done, only auth refs remain)
**File:** `packages/core/src/global.ts`

The `global.ts` already implements worktree-relative paths after `initFromWorktree()` is called. The remaining work:
- Verify no `XDG_*` references remain in path resolution
- Remove `ensureDirs()` setTimeout (line 71-73) — dirs are created lazily by consumers

### 5. Add `.gitignore` for `.opencode/data/` (already done at repo root)
Verified: `.gitignore` line 37 already has `.opencode/data`. No action needed.

### 6. Move config files to executable-adjacent
**Files affected:** `config/config.ts`, `gateway/config-manager.ts`, `plugin/meta.ts`, `provider/provider.ts`
- `opencode.jsonc` → `{exeDir}/opencode.jsonc`
- `tui.json/jsonc` → merged into `opencode.jsonc`
- `gateway.jsonc` → `{exeDir}/gateway.jsonc`
- `AGENTS.md` → `{exeDir}/AGENTS.md`
- `model.json` → `{worktree}/.opencode/data/model.json`
- `plugin-meta.json` → `{worktree}/.opencode/data/plugin-meta.json`

### 7. Temp directory: `{worktree}/.opencode/data/tmp/` (3 usages)
**Files affected (3 actual `os.tmpdir()` usages — corrected from 4):**
- `cli/cmd/tui/util/sound.ts:15` — sound effect cache
- `cli/cmd/tui/util/editor.ts:13` — external editor temp file
- `cli/cmd/tui/util/clipboard.ts:51` — clipboard temp image
- `lsp/server.ts:1270` already uses `Global.Path.data + "tmp"` — no change needed

### 8. Remove backward migration dead code
**Done:** `storage/json-migration.ts` and `storage/project-db-migration.ts` are deleted.
**Done:** `session_index` table and all CRUD code already removed.
**Done:** `getChannelPath()` already removed.
**Done:** `storage/global.sql.ts` already empty (1 blank line).

**Remaining:**
- `storage/storage.ts` — still used for `NotFoundError` + JSON summary/revert/server paths. Delete when consumers are migrated.

### 9. Update all path construction call sites
**Files affected:** 128 `Global.Path` references across 55 files
- Audit every `Global.Path.*` reference
- Update to new resolution (worktree-relative or exe-adjacent as appropriate)

### 10. Document environment variables
**File:** `docs/external-file-locations.md` (new)
- Complete reference table of all `OPENCODE_*` env vars with defaults and descriptions

### 11. Document all paths in report
**File:** `docs/external-file-locations.md`
- 9 sections: path resolution, data dir, exe-adjacent files, temp dir, `.opencode/` layout, managed configs, hardcoded paths, env vars, retention policies

### 12. Validate with explore agent
After implementation, run explore agent to verify every path in the report matches actual code.

---

## Files to Modify (~55 files, 2 files to delete eventually)

**Files to DELETE (when consumers migrated):**
- `storage/storage.ts` — legacy JSON file storage (still used by summary/revert/server)
- `storage/global.sql.ts` — already empty, safe to delete

**Files to MODIFY:**

| Priority | Category | Files |
|----------|----------|-------|
| **P0** | DB schema | `storage/db.ts` |
| **P0** | Global DB removal | `storage/db.ts`, `sync/index.ts`, `session/message-v2.ts`, `storage/project-db.ts`, `session/session.ts` |
| **P0** | Auth location | `auth/index.ts`, `mcp/auth.ts`, `cli/cmd/providers.ts` |
| High | Core path resolution | `packages/core/src/global.ts` |
| High | Sync | `sync/index.ts` |
| High | Session | `session/session.ts`, `session/projectors.ts` |
| High | Config | `config/config.ts`, `config/managed.ts`, `config/agent.ts`, `config/command.ts` |
| High | Gateway | `provider/gateway/store.ts`, `provider/gateway/adaptive-client.ts`, `provider/gateway/config-manager.ts`, `provider/gateway/mod.ts` |
| High | LSP | `lsp/server.ts` (10+ binary download paths) |
| Med | Tools | `file/ripgrep.ts`, `tool/edit.ts`, `tool/edit-backup.ts`, `tool/truncation-dir.ts`, `tool/external-directory.ts` |
| Med | Session | `session/session.ts`, `session/instruction.ts` |
| Med | Plugin | `plugin/meta.ts`, `plugin/install.ts`, `plugin/shared.ts` |
| Med | Snapshot/Worktree | `snapshot/index.ts`, `worktree/index.ts` |
| Med | Provider | `provider/provider.ts`, `provider/models.ts` |
| Med | CLI/TUI (core) | `cli/heap.ts` |
| Med | CLI/TUI (context) | `cli/cmd/tui/context/sync.tsx`, `cli/cmd/tui/context/directory.ts`, `cli/cmd/tui/context/kv.tsx`, `cli/cmd/tui/context/local.tsx`, `cli/cmd/tui/context/theme.tsx` |
| Med | CLI/TUI (component) | `cli/cmd/tui/component/prompt/frecency.tsx`, `cli/cmd/tui/component/prompt/history.tsx`, `cli/cmd/tui/component/prompt/stash.tsx`, `cli/cmd/tui/feature-plugins/home/footer.tsx`, `cli/cmd/tui/feature-plugins/sidebar/footer.tsx` |
| Med | CLI/TUI (routes) | `cli/cmd/tui/routes/session/permission.tsx` |
| Med | CLI/TUI (util) | `cli/cmd/tui/util/sound.ts`, `cli/cmd/tui/util/editor.ts`, `cli/cmd/tui/util/clipboard.ts` |
| Med | CLI/TUI (config) | `cli/cmd/tui/config/tui.ts`, `cli/cmd/tui/config/tui-migrate.ts` |
| Med | CLI/TUI (plugin) | `cli/cmd/tui/plugin/runtime.ts` |
| Med | CLI (commands) | `cli/cmd/agent.ts`, `cli/cmd/debug/index.ts`, `cli/cmd/gateway.ts`, `cli/cmd/mcp.ts`, `cli/cmd/plug.ts`, `cli/cmd/providers.ts`, `cli/cmd/uninstall.ts`, `cli/cmd/run.ts` |
| Med | Agent | `agent/agent.ts` |
| Low | Desktop | `desktop-electron/migrate.ts`, `desktop-electron/server.ts` |
| Low | Control plane | `control-plane/dev/debug-workspace-plugin.ts` |
| P0 | Tests | `test/storage/db.test.ts`, `test/account/service.test.ts`, `test/account/repo.test.ts`, `test/server/httpapi-experimental.test.ts` |
| Low | Docs | `docs/external-file-locations.md` (new), `docs/README.md` |

---

## Verification

1. `bun typecheck` in `packages/opencode`
2. All existing tests pass
3. **Run `opencode_v1` in `.tst1`** — should NOT crash with SQL logic error
4. Verify `{worktree}/.opencode/data/opencode.db` contains all tables: `project`, `account`, `account_state`, `session`, `message`, `part`, `todo`, `session_entry`, `permission`, `session_share`, `workspace`, `event_sequence`, `event`, `part_fts`
5. Verify `auth.json` read from executable directory, not `.opencode/data/`
6. Explore agent validates report against actual code
