# opencode External File Locations

All paths opencode reads from or writes to outside the project worktree.

## Path Resolution

opencode uses a worktree-based path layout. All data lives under the project's `.opencode/data/` directory. Config and auth files live next to the opencode executable.

| Platform | Data Root |
|----------|-----------|
| All | `{worktree}/.opencode/data/` |
| Config | `{exeDir}/` (alongside opencode.exe) |

The data directory **must be gitignored** — add `.opencode/data/` to `.gitignore`.

Multiple opencode versions (v1, v2, v2_1) on different filesystem paths each have their own config and auth next to the executable. The per-project data directory is shared by all versions.

## Data Directory (`{worktree}/.opencode/data/`)

| Path | Purpose |
|------|---------|
| `opencode.db` | SQLite database (always this name, no channel/version variants) |
| `opencode.db-wal` | Write-ahead log |
| `opencode.db-shm` | Shared memory file |
| `log/` | Application log/diff/payload files (`{time_ms}_{operation}_{model}_{session_id}.{ext}`, kept: 100) |
| `log/dev.log` | Dev mode log |
| `log/heap-<pid>-<timestamp>.heapsnapshot` | Heap snapshots (when `OPENCODE_AUTO_HEAP_SNAPSHOT` is set) |
| `cache/` | Cached data |
| `cache/bin/` | Downloaded binaries (ripgrep, ESLint, gopls, etc.) |
| `cache/skills/` | Skill discovery cache |
| `state/` | Per-project state |
| `state/model.json` | Recently used model/provider |
| `state/plugin-meta.json` | Plugin metadata (load counts, versions) |
| `storage/` | JSON storage (session diffs, legacy data) |
| `backups/<sessionID>/` | Edit tool backups (`*.bak` + `*.bak.meta.json`, kept: 50 per session) |
| `snapshot/<projectID>/<hash>/` | VCS snapshot git directories |
| `worktree/<projectID>/` | Git worktree roots |
| `tool-output/` | Truncated tool output cache |
| `tmp/` | Temporary files (replaces `os.tmpdir()`) |
| `tmp/opencode-sfx/` | Sound effect cache |
| `tmp/opencode-clipboard.png` | Clipboard temp image |
| `<timestamp>.md` | External editor temp file |
| `plans/` | Plan documents (when no project VCS) |

## Executable-Adjacent Files (`{exeDir}/`)

| File | Purpose |
|------|---------|
| `auth.json` | OAuth provider credentials |
| `mcp-auth.json` | MCP server OAuth tokens |
| `opencode.jsonc` | Global config (JSON with comments) |
| `opencode.json` | Global config (JSON) |
| `gateway.jsonc` | Gateway configuration |
| `AGENTS.md` | Global agent instructions |

## Per-Project Directory (`{worktree}/.opencode/`)

The `.opencode/` directory at the project root holds project-specific configuration. Everything under `.opencode/data/` is gitignored; the config files are tracked.

| Path | Purpose |
|------|---------|
| `.opencode/data/` | All runtime data (gitignored) |
| `.opencode/opencode.json` | Project config |
| `.opencode/opencode.jsonc` | Project config (with comments) |
| `.opencode/gateway.jsonc` | Project gateway config |
| `.opencode/AGENTS.md` | Project agent instructions |
| `.opencode/agent/` | Project agent definitions |
| `.opencode/command/` | Project custom commands |
| `.opencode/skill/` | Project skills |
| `.opencode/tool/` | Project custom tools |
| `.opencode/themes/` | Project themes |
| `.opencode/plugins/` | Project plugins |

## System Temp (`{worktree}/.opencode/data/tmp/`)

Temporary files live under the project data dir instead of the OS temp directory (`os.tmpdir()`).

| Path | Purpose |
|------|---------|
| `tmp/opencode-sfx/` | Cached sound effect files for TUI |
| `tmp/<timestamp>.md` | Temporary file for external editor (`VISUAL`/`EDITOR`) |
| `tmp/opencode-clipboard.png` | Temporary image file for clipboard |
| `tmp/opencode-jdtls-data*/` | Temporary data for Java LSP (JDTLS) |
| `tmp/ripgrep-*/` | Scoped temp dir for ripgrep extraction |

## Managed/Enterprise Configs

Managed configs live alongside the executable — same as all other config files. No OS-specific system paths. Copy the project + executable to any OS and it works.

| Platform | Path |
|----------|------|
| All | `{exeDir}/` (alongside opencode executable) |

Override via `OPENCODE_TEST_MANAGED_CONFIG_DIR` (tests only).

## Environment Variables

### Path Overrides

| Variable | Effect | Default |
|----------|--------|---------|
| `OPENCODE_DB` | DB file path (`:memory:`, absolute, or name) | `opencode.db` under data |
| `OPENCODE_CONFIG` | Custom config file path | exe-adjacent `opencode.jsonc` |
| `OPENCODE_CONFIG_DIR` | Custom config directory | exe-adjacent |
| `OPENCODE_CONFIG_CONTENT` | Inline config JSON (bypasses file) | — |
| `OPENCODE_AUTH_CONTENT` | Inline auth JSON (bypasses file) | — |
| `OPENCODE_GATEWAY_LOG_DIR` | Gateway log directory | `{data}/gateway/` |
| `OPENCODE_PLUGIN_META_FILE` | Plugin metadata path | `{data}/state/plugin-meta.json` |
| `OPENCODE_TEST_MANAGED_CONFIG_DIR` | Managed config dir (tests) | — |

### Behavior Flags

| Variable | Effect |
|----------|--------|
| `OPENCODE_PURE` | Pure mode (skip non-essential operations) |
| `OPENCODE_FAST_BOOT` | Skip startup checks |
| `OPENCODE_SERVER_PASSWORD` | Server auth password |
| `OPENCODE_SERVER_USERNAME` | Server auth username |
| `OPENCODE_CLIENT` | Client identifier |
| `OPENCODE_PID` | Process ID tracking |
| `OPENCODE_EDITOR_SSE_PORT` | Editor SSE port |
| `OPENCODE_ZED_DB` | Zed editor DB path |
| `OPENCODE_AUTO_HEAP_SNAPSHOT` | Auto heap snapshot on memory pressure |
| `OPENCODE_TEST_HOME` | Override home dir (tests) |

## Retention Policies

| Resource | Limit | Eviction |
|----------|-------|----------|
| Application log/diff/payload files | 100 files | Oldest deleted on init (sorted by time_ms prefix) |
| Edit backups | 50 per session | Oldest deleted first |
| Gateway logs | 1 MB size limit | Rotated, keeps 10 rotated files |
| Gateway store (routes) | 500 entries per Map | Stale entries (>1hr) evicted |
| Binaries (cache) | No limit | Manual cleanup needed |

## See Also

- [docs/README.md](README.md) — documentation index
- `packages/core/src/global.ts` — path resolution implementation
- `packages/opencode/src/storage/db.ts` — database path logic
