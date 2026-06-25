---
status: planned
owner: codex
created: 2026-06-25
priority: HIGH
reproduce:
  - cd packages/opencode && bun typecheck
  - bun test test/config/ --test-name-pattern "consolidation|encrypted|template"
---

# Config Consolidation Plan

## Goal

Replace 72 `OPENCODE_*` environment variables with a single `opencode.jsonc` config file containing all operational settings. Add `opencode.enc` encrypted mirror fallback (using existing `encrypted-json.ts`). Ship a commented template documenting every setting. Validate with JSON Schema. Preserve only 3 bootstrap env vars needed to locate the config file itself.

## Abstract Definition

```
Let E = { e₁, ..., e₇₂ } be all OPENCODE_* env var references
Let C = opencode.jsonc sections

Migration: ∀ e ∈ E:
  if e ∈ bootstrap:              keep as env (OPENCODE_CONFIG, OPENCODE_CONFIG_DIR, OPENCODE_TUI_CONFIG)
  if e ∈ build_time:             N/A — Bun define constants, not runtime (OPENCODE_VERSION, OPENCODE_CHANNEL, etc.)
  if e ∈ feature_flag:           move to C.experimental.* or C.features.*
  if e ∈ server_auth:            move to C.server.password / C.server.username
  if e ∈ operational:            move to C.{gateway,terminal,debug,paths}.*
  if e ∈ credential:             move to auth.enc (already handled by encrypted-json.ts)
  if e ∈ test_only:              keep as env (test infrastructure, never in production)
  if e ∈ deprecated:             delete references
```

## Formalization

```
Config reading:
  read(opencode.jsonc) → if exists: parse → Config.Info
  if absent: read(opencode.enc) → decrypt → parse → Config.Info
  if both absent: defaults

Config writing:
  write(opencode.jsonc) → write plaintext → mirror(opencode.enc) (fire-and-forget)
  if plaintext absent: write(opencode.enc) only (atomic tmp→rename)

Flag resolution:
  Flag.X = config.features.X ?? config.experimental.X ?? process.env.OPENCODE_X (deprecated, warned)
```

## Structural Diagram

```
Before (72 env vars scattered):
  process.env.OPENCODE_DISABLE_PRUNE → Flag.DISABLE_PRUNE → config.ts:782
  process.env.OPENCODE_SERVER_PASSWORD → middleware.ts:63 → Basic Auth
  process.env.OPENCODE_EXPERIMENTAL_HTTPAPI → server.ts:65 → route gating
  process.env.OPENCODE_GATEWAY_LOG_DIR → adaptive-client.ts:105 → log rotation
  process.env.OPENCODE_TERMINAL → pty/index.ts:215 → terminal mode
  process.env.OPENCODE_CLIENT → llm.ts:464 → user agent
  ... 66 more scattered across 30+ files

After (single config + encrypted mirror):
  opencode.jsonc ──parse──→ Config.Info (typed)
    ├── server.password → middleware.ts (effectful read via Config.Service)
    ├── server.username → middleware.ts
    ├── features.disablePrune → Flag (sourced from config)
    ├── features.disableAutoCompact → Flag
    ├── features.pure → Flag
    ├── experimental.httpApi → Flag
    ├── experimental.planMode → Flag
    ├── experimental.fileWatcher → Flag
    ├── experimental.markdown → Flag
    ├── gateway.logDir → adaptive-client.ts
    ├── terminal.mode → pty/index.ts
    ├── terminal.disableMouse → Flag
    ├── debug.showTTFD → Flag
    ├── debug.autoHeapSnapshot → Flag
    ├── paths.modelsUrl → provider/models.ts
    ├── paths.modelsPath → provider/models.ts
    ├── paths.gitBashPath → shell/shell.ts
    └── client.type → installation/index.ts

  opencode.enc ──decrypt──→ fallback if opencode.jsonc absent
    (existing encrypted-json.ts: readText/writeText/mirrorText)

  auth.enc ──decrypt──→ credentials (already built)
    (existing encrypted-json.ts + auth/index.ts: readAuthData/writeAuthData)
```

## Env Var Migration Map

### Category: Feature Flags (25 vars → `features.*` or `experimental.*`)

| Env Var | Config Path |
|---------|-------------|
| `OPENCODE_DISABLE_PRUNE` | `features.disablePrune` |
| `OPENCODE_DISABLE_AUTOCOMPACT` | `features.disableAutoCompact` |
| `OPENCODE_DISABLE_TERMINAL_TITLE` | `features.disableTerminalTitle` |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS` | `features.disableDefaultPlugins` |
| `OPENCODE_DISABLE_LSP_DOWNLOAD` | `features.disableLspDownload` |
| `OPENCODE_DISABLE_MODELS_FETCH` | `features.disableModelsFetch` |
| `OPENCODE_DISABLE_MOUSE` | `features.disableMouse` |
| `OPENCODE_DISABLE_CLAUDE_CODE` | `features.disableClaudeCode` |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` | `features.disableClaudeCodePrompt` |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | `features.disableClaudeCodeSkills` |
| `OPENCODE_DISABLE_EXTERNAL_SKILLS` | `features.disableExternalSkills` |
| `OPENCODE_DISABLE_EMBEDDED_WEB_UI` | `features.disableEmbeddedWebUI` |
| `OPENCODE_DISABLE_CHANNEL_DB` | `features.disableChannelDb` |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | `features.disableProjectConfig` |
| `OPENCODE_DISABLE_SHARE` | `features.disableShare` |
| `OPENCODE_AUTO_SHARE` | `features.autoShare` |
| `OPENCODE_PURE` | `features.pure` |
| `OPENCODE_STRICT_CONFIG_DEPS` | `features.strictConfigDeps` |
| `OPENCODE_FAST_BOOT` | `features.fastBoot` |
| `OPENCODE_SHOW_TTFD` | `debug.showTTFD` |
| `OPENCODE_AUTO_HEAP_SNAPSHOT` | `debug.autoHeapSnapshot` |
| `OPENCODE_EXPERIMENTAL` | `experimental.masterSwitch` |
| `OPENCODE_EXPERIMENTAL_HTTPAPI` | `experimental.httpApi` |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` | `experimental.fileWatcher` |
| `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` | `experimental.disableFileWatcher` |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE` | `experimental.planMode` |
| `OPENCODE_EXPERIMENTAL_MARKDOWN` | `experimental.markdown` |
| `OPENCODE_EXPERIMENTAL_ICON_DISCOVERY` | `experimental.iconDiscovery` |
| `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT` | `experimental.disableCopyOnSelect` |
| `OPENCODE_EXPERIMENTAL_LSP_TY` | `experimental.lspTy` |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL` | `experimental.lspTool` |
| `OPENCODE_EXPERIMENTAL_OXFMT` | `experimental.oxfmt` |
| `OPENCODE_EXPERIMENTAL_WEBSOCKETS` | `experimental.websockets` |
| `OPENCODE_EXPERIMENTAL_NATIVE_LLM` | `experimental.nativeLlm` |
| `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` | `experimental.eventSystem` |
| `OPENCODE_EXPERIMENTAL_WORKSPACES` | `experimental.workspaces` |
| `OPENCODE_ENABLE_EXA` / `OPENCODE_EXPERIMENTAL_EXA` | `experimental.exa` |
| `OPENCODE_ENABLE_QUESTION_TOOL` | `experimental.questionTool` |
| `OPENCODE_ENABLE_EXPERIMENTAL_MODELS` | `experimental.experimentalModels` |
| `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | `experimental.bashTimeoutMs` |
| `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | `experimental.outputTokenMax` |

### Category: Server Auth (2 vars → `server.*`)

| Env Var | Config Path |
|---------|-------------|
| `OPENCODE_SERVER_PASSWORD` | `server.password` |
| `OPENCODE_SERVER_USERNAME` | `server.username` (default: `"opencode"`) |

### Category: Operational (15 vars → various sections)

| Env Var | Config Path |
|---------|-------------|
| `OPENCODE_GATEWAY_LOG_DIR` | `gateway.logDir` |
| `OPENCODE_MODELS_URL` | `paths.modelsUrl` |
| `OPENCODE_MODELS_PATH` | `paths.modelsPath` |
| `OPENCODE_GIT_BASH_PATH` | `paths.gitBashPath` |
| `OPENCODE_PLUGIN_META_FILE` | `paths.pluginMetaFile` |
| `OPENCODE_CLIENT` | `client.type` |
| `OPENCODE_TERMINAL` | `terminal.mode` |
| `OPENCODE_DB` | `paths.dbPath` |
| `OPENCODE_PERMISSION` | `permission.policy` (inline JSON) |
| `OPENCODE_CONFIG_CONTENT` | _(internal — parent→child IPC, keep as env for workspace mode)_ |
| `OPENCODE_FAKE_VCS` | `debug.fakeVcs` |
| `OPENCODE_WORKSPACE_ID` | _(internal — workspace isolation, keep as env)_ |
| `OPENCODE_PID` | _(internal — process tracking, keep as env)_ |
| `OPENCODE_RUN_ID` | _(internal — worker propagation, keep as env)_ |
| `OPENCODE_PROCESS_ROLE` | _(internal — worker identification, keep as env)_ |

### Category: Keep as Env (Bootstrap — 3 vars)

| Env Var | Reason |
|---------|--------|
| `OPENCODE_CONFIG` | Path to config file — must exist before config can be read |
| `OPENCODE_CONFIG_DIR` | Config directory override — must exist before config can be read |
| `OPENCODE_TUI_CONFIG` | TUI config path override — must exist before TUI config can be read |

### Category: Keep as Env (Internal/Test — 11 vars)

| Env Var | Reason |
|---------|--------|
| `OPENCODE_AUTH_CONTENT` | Parent→child IPC for auth in workspace mode |
| `OPENCODE_WORKSPACE_ID` | Workspace isolation identifier |
| `OPENCODE_RUN_ID` | Unique run identifier for child workers |
| `OPENCODE_PROCESS_ROLE` | Worker role label |
| `OPENCODE_PID` | Process ID tracking |
| `OPENCODE_SKIP_MIGRATIONS` | CI/testing flag |
| `OPENCODE_EDITOR_SSE_PORT` | Editor integration runtime port |
| `OPENCODE_ZED_DB` | Zed editor database path (runtime) |
| `OPENCODE_CALLER` | IDE caller identifier (runtime injection) |
| `OPENCODE_ROUTE` | JSON-serialized TUI route state |
| `OPENCODE_PORT` | Desktop Electron server port |
| All `OPENCODE_TEST_*` (8 vars) | Test infrastructure only |

### Category: Delete (Deprecated/Removed — 5 vars)

| Env Var | Status |
|---------|--------|
| `OPENCODE_ALLOW_DOWNGRADE` | Electron updater — feature removed |
| `OPENCODE_DISABLE_AUTOUPDATE` | Removed |
| `OPENCODE_ALWAYS_NOTIFY_UPDATE` | Removed |
| `OPENCODE_MIGRATIONS` | Migration directories bundled but flag unused |
| `OPENCODE_STREAM_STALL_TIMEOUT_MS` | Obsolete proposal |

## New opencode.jsonc Sections

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  
  // ── Server ───────────────────────────────────────────────────────────
  // HTTP API server authentication.
  "server": {
    // Basic auth password. If set, all HTTP API requests require
    // Authorization: Basic <base64(username:password)>
    "password": null,
    // Basic auth username. Defaults to "opencode".
    "username": "opencode"
  },
  
  // ── Client ──────────────────────────────────────────────────────────
  // Client identification for user-agent and tool filtering.
  "client": {
    // One of: "cli", "acp", "desktop", "app". Auto-detected if unset.
    "type": null
  },
  
  // ── Features ────────────────────────────────────────────────────────
  // Boolean feature toggles. All default to false (enabled).
  "features": {
    "disablePrune": false,
    "disableAutoCompact": false,
    "disableTerminalTitle": false,
    "disableDefaultPlugins": false,
    "disableLspDownload": false,
    "disableModelsFetch": false,
    "disableMouse": false,
    "disableClaudeCode": false,
    "disableClaudeCodePrompt": false,
    "disableClaudeCodeSkills": false,
    "disableExternalSkills": false,
    "disableEmbeddedWebUI": false,
    "disableChannelDb": false,
    "disableProjectConfig": false,
    "disableShare": false,
    "autoShare": false,
    "pure": false,
    "strictConfigDeps": false,
    "fastBoot": false
  },
  
  // ── Experimental ────────────────────────────────────────────────────
  // Experimental features. May change or be removed without notice.
  "experimental": {
    // Master kill-switch: enables ALL experimental features when true.
    "masterSwitch": false,
    // Effect-based HTTP API (replaces legacy Hono routes).
    "httpApi": false,
    // Parcel file watcher for faster file change detection.
    "fileWatcher": false,
    "disableFileWatcher": false,
    // Plan mode: agent proposes plan before implementing.
    "planMode": false,
    // Markdown rendering in TUI (default: true).
    "markdown": true,
    // File-type icon discovery.
    "iconDiscovery": false,
    // Disable auto-copy-on-select in TUI.
    "disableCopyOnSelect": false,
    // Use TY LSP server instead of pyright for TypeScript/Python.
    "lspTy": false,
    // Expose LSP as a tool callable by the agent.
    "lspTool": false,
    // Use oxfmt formatter.
    "oxfmt": false,
    // Effect-based WebSocket support.
    "websockets": false,
    // Native LLM integration in Effect runtime.
    "nativeLlm": false,
    // Effect-based event system.
    "eventSystem": false,
    // Workspace isolation mode.
    "workspaces": false,
    // Use `exa` instead of `ls` for directory listing.
    "exa": false,
    // Enable the `question` tool for ACP mode.
    "questionTool": false,
    // Include alpha/experimental models in provider lists.
    "experimentalModels": false,
    // Override default bash tool timeout in milliseconds (default: 60000).
    "bashTimeoutMs": 60000,
    // Cap on output tokens (default: 32000).
    "outputTokenMax": 32000
  },
  
  // ── Gateway ─────────────────────────────────────────────────────────
  // Provider HTTP gateway configuration.
  "gateway": {
    // Directory for HTTP request/response log rotation.
    // Logs include full request bodies — disable in production.
    "logDir": null
  },
  
  // ── Terminal ────────────────────────────────────────────────────────
  // Terminal and TUI behavior.
  "terminal": {
    // PTY mode: "auto" (detect), "pty" (ConPTY), or "basic" (no PTY).
    "mode": "auto",
    // Disable mouse input in TUI.
    "disableMouse": false,
    // Show Time-To-First-Display metric on startup.
    "showTTFD": false
  },
  
  // ── Debug ───────────────────────────────────────────────────────────
  // Debug and diagnostic settings. NOT for production use.
  "debug": {
    // Auto heap snapshot on memory pressure.
    "autoHeapSnapshot": false,
    // Inject fake VCS data (for testing).
    "fakeVcs": false
  },
  
  // ── Paths ───────────────────────────────────────────────────────────
  // File path overrides. Useful for offline/custom environments.
  "paths": {
    // Remote models.json endpoint. Default: https://models.dev
    "modelsUrl": null,
    // Local models.json path override (takes priority over modelsUrl).
    "modelsPath": null,
    // Path to Git Bash installation (Windows only, for less.exe etc.).
    "gitBashPath": null,
    // Path to plugin metadata JSON.
    "pluginMetaFile": null,
    // Database path override (:memory:, absolute path, or filename).
    "dbPath": null,
    // TUI config file path override.
    "tuiConfig": null
  }
}
```

## Tasks

### Sub-Goal 1: Schema Extension (1 day)
- [ ] 1.1 Add `server`, `client`, `features`, `experimental`, `gateway`, `terminal`, `debug`, `paths` schemas to `src/config/config.ts` `Info` type
- [ ] 1.2 All new fields: `Schema.optional(...)` — existing configs work without migration
- [ ] 1.3 Add JSON Schema `$defs` for each new section at `opencode.ai/config.json`

### Sub-Goal 2: Env Var Migration Map (1 day)
- [ ] 2.1 Create exhaustive `ENV_TO_CONFIG_MAP: Record<string, string>` mapping (env var → config dot-path)
- [ ] 2.2 Implement `applyEnvOverrides(config: Info): Info` — reads old env vars, applies to config, logs deprecation warning
- [ ] 2.3 Add `Config.migrateFromEnv()` utility for one-time migration

### Sub-Goal 3: Config Loading with Encrypted Fallback (1 day)
- [ ] 3.1 Wire `opencode.jsonc` / `opencode.json` → `opencode.jsonc.enc` fallback in `readConfigFile()`
- [ ] 3.2 Wire `writeConfigFile()` → `EncryptedJsonStorage.mirrorText()` for encrypted mirror
- [ ] 3.3 Ensure fallback works for all config file candidates (`opencode.jsonc`, `opencode.json`, `config.json`)
- [ ] 3.4 Add test: delete plaintext, encrypted fallback loads correct config

### Sub-Goal 4: Flag.ts Migration (2 days)
- [ ] 4.1 Convert `Flag.*` getters from `process.env[VAR]` → read from `Config.Info` via `Config.Service`
- [ ] 4.2 Keep env var as fallback during one-release transition with deprecation warning
- [ ] 4.3 Update all 40+ flag definitions in `packages/core/src/flag/flag.ts`
- [ ] 4.4 Add `Flag.fromConfig(config: Config.Info)` initialization
- [ ] 4.5 Update all flag consumers to use config-based flags

### Sub-Goal 5: Feature Flag Consumers (1 day)
- [ ] 5.1 `OPENCODE_EXPERIMENTAL_HTTPAPI` → `config.experimental.httpApi` in `server.ts`, `index.ts`
- [ ] 5.2 All `OPENCODE_DISABLE_*` → `config.features.disable*` across codebase
- [ ] 5.3 `OPENCODE_PURE` → `config.features.pure`
- [ ] 5.4 `OPENCODE_CLIENT` → `config.client.type`
- [ ] 5.5 Update all TUI, server, plugin, provider code

### Sub-Goal 6: Server Auth Migration (0.5 day)
- [ ] 6.1 `OPENCODE_SERVER_PASSWORD` → `config.server.password` in middleware.ts:63
- [ ] 6.2 `OPENCODE_SERVER_USERNAME` → `config.server.username` in middleware.ts:65
- [ ] 6.3 Update httpapi/auth.ts:32-34 (Effect HttpApi auth)
- [ ] 6.4 Update cmd/web.ts, cmd/serve.ts, cmd/run.ts, tui/attach.ts, tui/worker.ts

### Sub-Goal 7: Template + Validation (1 day)
- [ ] 7.1 Create `opencode.jsonc` template with all settings commented out + documentation
- [ ] 7.2 Generate/update JSON Schema at `https://opencode.ai/config.json`
- [ ] 7.3 Ship template with binary (copy to `Global.Path.config` on first run)
- [ ] 7.4 Add `opencode config template` CLI command to regenerate template

### Sub-Goal 8: Cleanup (1 day)
- [ ] 8.1 Delete deprecated env var references (`OPENCODE_ALLOW_DOWNGRADE`, etc.)
- [ ] 8.2 Add one-release deprecation shim: if old env var set, `log.warn("use opencode.jsonc instead")` but still apply value
- [ ] 8.3 Mark `OPENCODE_SKIP_MIGRATIONS` as debug-only (keep, but document)
- [ ] 8.4 Document env var → config migration path in `docs/` and README

### Sub-Goal 9: Tests (1 day)
- [ ] 9.1 Config loads from opencode.jsonc with all new sections populated
- [ ] 9.2 Encrypted fallback: delete plaintext, ensure opencode.enc is read
- [ ] 9.3 Template JSON validates against schema
- [ ] 9.4 Bootstrap `OPENCODE_CONFIG` overrides config path
- [ ] 9.5 Old env vars produce deprecation warning but still function
- [ ] 9.6 Feature flags from config override env var defaults
- [ ] 9.7 Server auth from config: HTTP 401 without correct password
- [ ] 9.8 Typecheck passes with zero errors after all migrations

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Config with `server.password: "secret"` sets basic auth | HTTP 401 without correct credentials |
| 2 | Config with `features.disablePrune: true` skips pruning | Session not pruned after age threshold |
| 3 | `opencode.jsonc` deleted, `opencode.enc` present in config dir | Config loads from encrypted fallback |
| 4 | Template file validates against JSON Schema | `validate(template, schema)` returns no errors |
| 5 | Bootstrap `OPENCODE_CONFIG=/custom/path/opencode.jsonc` overrides | Custom path used for config load |
| 6 | Old `OPENCODE_DISABLE_PRUNE=1` env var set, config absent | Deprecation warning logged, prune still disabled |
| 7 | New config section added, old install without it | Defaults applied, no crash |
| 8 | `opencode config template` CLI command | Template written to stdout |
| 9 | All 25+ feature flags read from config, zero env var reads | No `process.env.OPENCODE_*` in flag resolution path |
| 10 | Encrypted mirror: write config → both plaintext AND .enc created | Both files exist, .enc decrypts to same content |

## Risks

- **MEDIUM**: Flag.ts migration touches 40+ getters in `packages/core/src/flag/flag.ts`. Any mistake breaks feature gating across the entire application.
- **MEDIUM**: One-release deprecation shim needs careful lifecycle — must be removed in next release. Track with TODO(deprecation-removal).
- **LOW**: Encrypted fallback for `opencode.jsonc` reuses existing `encrypted-json.ts` which is battle-tested for `auth.json`/`auth.enc`. Same pattern, different file.
- **LOW**: Template shipped with binary adds build step. Mitigation: embed as string constant. Recompile to update.

## Effort Estimate

| Sub-Goal | Effort |
|----------|--------|
| 1. Schema Extension | 1 day |
| 2. Env Var Migration Map | 1 day |
| 3. Config + Encrypted Fallback | 1 day |
| 4. Flag.ts Migration | 2 days |
| 5. Feature Flag Consumers | 1 day |
| 6. Server Auth Migration | 0.5 day |
| 7. Template + Validation | 1 day |
| 8. Cleanup | 1 day |
| 9. Tests | 1 day |

**Total: 9.5 days**
