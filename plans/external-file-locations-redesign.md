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

---

## Goal

Redesign opencode's external file layout to be fully per-project (no global state) and document every path.

## Current vs Target Architecture

| Aspect | Current | Target |
|--------|---------|--------|
| Data root | `~/.local/share/opencode/` (xdg-basedir, shared across projects) | `{worktree}/.opencode/data/` (per-project, gitignored) |
| Config files | `~/.config/opencode/opencode.jsonc` | `{exeDir}/opencode.jsonc` (next to executable) |
| Auth | `~/.local/share/opencode/auth.json` | `{exeDir}/auth.json` (next to executable) |
| DB name | `opencode.db` or `opencode-{channel}.db` (per-channel) | Always `opencode.db` — no channel/version variants. GUI/v2/v2_1 each have own config+auth at their exe path; per-project data stays compatible. |
| Temp files | `os.tmpdir()` | `{worktree}/.opencode/data/tmp/` |
| Global DB | Yes (accounts, project listing) | **No** — fully per-project, no cross-project state |
| Per-project DB | `{worktree}/.opencode/project.db` | `{worktree}/.opencode/data/opencode.db` |
| Backward migrations | `json-migration.ts` (JSON→SQLite), `project-db-migration.ts` (global→per-project) | **Removed** — clean break, no legacy support |
| Legacy JSON storage | `storage/storage.ts` — JSON file-based session storage | Migration behavior removed; service deletion pending remaining summary/revert/server consumers |

## Implementation Tasks

### 1. Fix `Global.Path` resolution
**File:** `packages/core/src/global.ts`
- Change xdg-basedir roots from `~/.local/share|state|config|cache/opencode` to `{worktree}/.opencode/data/`
- `Global.Path.data` → `{worktree}/.opencode/data`
- `Global.Path.state` → same as data (merged, no separate state dir)
- `Global.Path.config` → executable-adjacent (`path.dirname(process.execPath)`) — this is where `.jsonc` config/auth files live
- `Global.Path.cache` → `{worktree}/.opencode/data/cache`
- `Global.Path.bin` → `{worktree}/.opencode/data/cache/bin`
- `Global.Path.log` → `{worktree}/.opencode/data/log`
- Database: always `opencode.db` at `{worktree}/.opencode/data/opencode.db` — remove channel-based naming (`getChannelPath()`)
- Remove auto-creation of XDG dirs at module load

### 2. Add `.gitignore` for `.opencode/data/`
- Ensure `.opencode/data/` is gitignored (add to existing `.opencode/.gitignore` or create one)
- `.opencode/` itself stays tracked (configs go next to exe, not here)

### 3. Move config/auth files to executable-adjacent
**Files affected:** `auth/index.ts`, `mcp/auth.ts`, `config/config.ts`, `gateway/config-manager.ts`, `plugin/meta.ts`, `provider/provider.ts`
- `auth.json` → `{exeDir}/auth.json`
- `mcp-auth.json` → `{exeDir}/mcp-auth.json`
- `opencode.jsonc` → `{exeDir}/opencode.jsonc` (same extension, next to exe)
- `tui.json/jsonc` → merged into `opencode.jsonc`
- `gateway.jsonc` → `{exeDir}/gateway.jsonc`
- `AGENTS.md` → `{exeDir}/AGENTS.md`
- `model.json` → `{worktree}/.opencode/data/model.json` (project-specific state)
- `plugin-meta.json` → `{worktree}/.opencode/data/plugin-meta.json`
- Rationale: multiple opencode versions (v1, v2, v2_1) on different paths each have their own auth+config — version-isolated configuration.

### 4. Temp directory: `{worktree}/.opencode/data/tmp/`
**Files affected (4 actual `os.tmpdir()` usages):**
- `lsp/server.ts:1270` — JDTLS data directory
- `cli/cmd/tui/util/sound.ts:15` — sound effect cache
- `cli/cmd/tui/util/editor.ts:13` — external editor temp file
- `cli/cmd/tui/util/clipboard.ts:51` — clipboard temp image
- Replace all `os.tmpdir()` usages with `path.join(worktree, ".opencode", "data", "tmp")`
- Remove `/tmp/opencode-workspace-dev-data.json` hardcoded path → use data/tmp
- Note: `file/ripgrep.ts` uses `Global.Path.bin`, not `os.tmpdir()`

### 5. Remove global DB / session_index / backward migrations
**Files to remove entirely:**
- `storage/json-migration.ts` — legacy JSON→SQLite migration (no backward compatibility)
- `storage/project-db-migration.ts` — global→per-project migration (always project-DB from start)
- `storage/storage.ts` — legacy JSON file-based session storage
- `storage/global.sql.ts` (keep only `account` tables, drop `session_index`)

**Files to modify (5 total):** `storage/db.ts`, `storage/global.sql.ts`, `sync/index.ts`, `session/session.ts`, `session/projectors.ts`
- Remove `session_index` table and all CRUD code
- Remove `getChannelPath()` — always `opencode.db`
- Remove `resolveProjectInfo()` fallback SQL in `sync/index.ts` (queries session_index)
- Remove `listGlobal()` project-DB-mode path in `session.ts` (depends on session_index)
- Remove `SessionIndexTable` CRUD in projectors event handlers
- Remove `projectClients` Map — only one DB per project
- Simplify `Database.use()` to always use project DB
- Remove all `XDG_*`, `OPENCODE_DISABLE_CHANNEL_DB` flag dependencies from global.ts and db.ts

### 6. Update all path construction call sites
**Files affected:** 128 `Global.Path` references across 55 files
- Audit every `Global.Path.*` reference
- Update to new resolution (worktree-relative or exe-adjacent as appropriate)

### 7. Document environment variables
**File:** `docs/external-file-locations.md`
- Full list of every `OPENCODE_*` and `XDG_*` override with:
  - Variable name
  - What it overrides
  - Expected values (path, bool, string)
  - Platform notes
  - Default value
- Known env vars to document:
  - `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` (xdg-basedir overrides)
  - `OPENCODE_TEST_HOME` — test home directory override
  - `OPENCODE_DB` — DB file path (or `:memory:`)
  - `OPENCODE_CONFIG` — custom config file path
  - `OPENCODE_CONFIG_DIR` — custom config directory
  - `OPENCODE_CONFIG_CONTENT` — inline config content (bypasses file)
  - `OPENCODE_AUTH_CONTENT` — inline auth JSON (bypasses file)
  - `OPENCODE_GATEWAY_LOG_DIR` — gateway log dir override
  - `OPENCODE_PLUGIN_META_FILE` — plugin meta file override
  - `OPENCODE_PURE` — pure mode flag
  - `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME` — server auth
  - `OPENCODE_FAST_BOOT` — skip startup checks
  - `OPENCODE_PID` — process ID tracking
  - `OPENCODE_CLIENT` — client identifier
  - `OPENCODE_EDITOR_SSE_PORT` — editor SSE port
  - `OPENCODE_ZED_DB` — Zed editor database path
  - `OPENCODE_TEST_MANAGED_CONFIG_DIR` — test-only managed config dir

### 8. Document all paths in report
**File to create:** `docs/external-file-locations.md`
**Sections:**
1. Path Resolution — `{worktree}/.opencode/data/` as unified base
2. Data Directory — database, logs, backups, cache, temp, state
3. Executable-Adjacent Files — auth, config (jsonl), gateway config, AGENTS.md
4. System Temp — `{worktree}/.opencode/data/tmp/`
5. `.opencode/` Layout — what lives where, gitignore rules
6. Managed/Enterprise Configs — executable-adjacent
7. Hardcoded Paths — any remaining, with details
8. Environment Variables — complete reference table
9. Retention Policies — log rotation, backup limits, gateway rotation

**Also create:** `docs/README.md` — doc index (doesn't exist yet, only `ADID_Framework_15_3.md` in docs). Add entry for the new report.

### 9. Validate with explore agent
After implementation, run explore agent to verify every path in the report matches actual code.

## Files to Modify (~50 files, 3 files to delete entirely)

**Files to DELETE:**
- `storage/json-migration.ts` — legacy backward migration
- `storage/project-db-migration.ts` — global→per-project migration
- `storage/storage.ts` — legacy JSON file storage (plus its migrations)

**Files to MODIFY:**

| Category | Files |
|----------|-------|
| Core path resolution | `packages/core/src/global.ts` |
| Storage/DB | `storage/db.ts`, `storage/global.sql.ts` |
| Sync | `sync/index.ts` |
| Session | `session/session.ts`, `session/projectors.ts` |
| Auth | `auth/index.ts`, `mcp/auth.ts` |
| Config | `config/config.ts`, `config/managed.ts`, `config/agent.ts`, `config/command.ts` |
| Gateway | `provider/gateway/store.ts`, `provider/gateway/adaptive-client.ts`, `provider/gateway/config-manager.ts`, `provider/gateway/mod.ts` |
| LSP | `lsp/server.ts` (10+ binary download paths) |
| Tools | `file/ripgrep.ts`, `tool/edit.ts`, `tool/edit-backup.ts`, `tool/truncation-dir.ts`, `tool/external-directory.ts` |
| Session | `session/session.ts`, `session/instruction.ts` |
| Plugin | `plugin/meta.ts`, `plugin/install.ts`, `plugin/shared.ts` |
| Snapshot/Worktree | `snapshot/index.ts`, `worktree/index.ts` |
| Provider | `provider/provider.ts`, `provider/models.ts` |
| CLI/TUI (core) | `cli/heap.ts` |
| CLI/TUI (context) | `cli/cmd/tui/context/sync.tsx`, `cli/cmd/tui/context/directory.ts`, `cli/cmd/tui/context/kv.tsx`, `cli/cmd/tui/context/local.tsx`, `cli/cmd/tui/context/theme.tsx` |
| CLI/TUI (component) | `cli/cmd/tui/component/prompt/frecency.tsx`, `cli/cmd/tui/component/prompt/history.tsx`, `cli/cmd/tui/component/prompt/stash.tsx`, `cli/cmd/tui/feature-plugins/home/footer.tsx`, `cli/cmd/tui/feature-plugins/sidebar/footer.tsx` |
| CLI/TUI (routes) | `cli/cmd/tui/routes/session/permission.tsx` |
| CLI/TUI (util) | `cli/cmd/tui/util/sound.ts`, `cli/cmd/tui/util/editor.ts`, `cli/cmd/tui/util/clipboard.ts` |
| CLI/TUI (config) | `cli/cmd/tui/config/tui.ts`, `cli/cmd/tui/config/tui-migrate.ts` |
| CLI/TUI (plugin) | `cli/cmd/tui/plugin/runtime.ts` |
| CLI (commands) | `cli/cmd/agent.ts`, `cli/cmd/debug/index.ts`, `cli/cmd/gateway.ts`, `cli/cmd/mcp.ts`, `cli/cmd/plug.ts`, `cli/cmd/providers.ts`, `cli/cmd/uninstall.ts`, `cli/cmd/run.ts` |
| Agent | `agent/agent.ts` |
| Desktop | `desktop-electron/migrate.ts`, `desktop-electron/server.ts` |
| Control plane | `control-plane/dev/debug-workspace-plugin.ts` |
| Docs | `docs/external-file-locations.md` (new), `docs/README.md` |

## Verification

1. `bun typecheck` in `packages/opencode`
2. All existing tests pass (check for path-dependent tests)
3. Explore agent validates report against actual code
4. Manual: launch opencode, verify `.opencode/data/` created under worktree
5. Manual: verify `.opencode/data/` is gitignored
6. Manual: verify auth/config files read from executable directory
