# MASTER PLAN: Settings — full inventory, editability, jsonc policy

plan_id: 2026-08-31-settings-master
state: ACTIVE
created_by: build_mode
revision: 1
policy_author: Alexander (2026-08-31, 04:32–04:42 UTC)

## Policy (verbatim decisions)

1. Конфига 3 типа: **global, worktree, session based. ВСЕ редактируемы.**
2. Если сохраняем в **global** → **confirmation dialog** обязателен (write applies to all projects).
3. Все settings-файлы — **jsonc с `//` комментариями**.
4. **Если хоть какая-то настройка отсутствует** (не покрыта инвентарём / не редактируема / не задокументирована) — **это баг, подлежащий исправлению**.
5. Settings-опция в TUI: полная интерактивность — **не только programable shortcuts, но и mouse**.

## Layer definitions (resolution chain — local.tsx:360-376 forAgent)

| Layer | File | Written by | Notes |
|---|---|---|---|
| **session** | `{worktree}/.opencode/data/sessions/{sessionID}.jsonc` | `saveSessionSettings` (session-settings.ts:300-322) | per-conversation overrides; highest priority |
| **worktree** | `{worktree}/.opencode/data/state/model.json` | `Filesystem.writeJson` (local.tsx:264-265) | all sessions of the project; workspaceAgent[workspaceID] keyed (session-settings.ts:55-74) |
| **global** | `Global.Path.config/opencode.jsonc` (**executable-adjacent — NOT `~/.config/opencode`**, AGENTS.md path architecture) | `Config.updateGlobal` (config.ts:1072-1091) via PATCH `/global/config` | user-level defaults; **confirmation dialog required** |

## INVENTORY (report) — grouped. Every row: layer(s), dependent code, TUI-editable today

### A. Core config (config.ts:100-410 `Info` schema)

| Field group | Fields | Layer | Dependent code | TUI-editable |
|---|---|---|---|---|
| identity | `username`, `client.type` | G/W/S | config.ts:868 | ❌ bug-gap |
| shell/terminal | `shell`, `terminal.{mode,disableMouse}` | G/W/S | config.ts:104; features.disableMouse | ❌ gap |
| logging | `logLevel`, `debug.{showTTFD,autoHeapSnapshot,fakeVcs}`, `gateway.logDir` | G/W/S | Log.create consumers | ❌ gap |
| models | `model`, `small_model`, `default_agent` | G/W/S | provider.ts, agent resolution | ⚠️ partial — /agents dialog (scope-aware since 2026-08-31) |
| providers | `provider`, `disabled_providers`, `enabled_providers`, `paths.{modelsUrl,modelsPath}` | G/W/S | provider.ts:1042/1396 (variants injection) | ⚠️ model pick only; provider CRUD ❌ gap |
| agents | `agent` (ConfigAgent: model/variant/description/prompt/tools/temperature/top_p/permissions/subagents…) | G/W/S | config/agent.ts:23-62; task.ts/pipeline.ts resolveAgentModel | ⚠️ model+variant+subagents via /agents; prompt/tools ❌ gap |
| pipelines | `pipelines` (steps/variant/prompt/context) | G/W/S | pipeline.ts | ❌ gap |
| commands | `command` | G/W/S | config/command.ts | ❌ gap |
| skills/instructions | `skills`, `instructions` | G/W/S | config/skills.ts; instruction.ts | ❌ gap |
| mcp | `mcp` (local/remote servers, enabled) | G/W/S | config/mcp.ts; TUI /mcps toggle (dialog exists) | ⚠️ toggle only; add/edit ❌ gap |
| permissions | `permission` (edit/bash/webfetch/external_directory…), `navigation.{allow,deny}`, `external_directory_mode`, `bypass_constitution` | G/W/S | config/permission.ts; runtime guard | ⚠️ dialog prompts; persistent rules ❌ gap |
| sandbox | `sandbox.{enabled,system,git,outside,missing,blocked}` | G/W/S | bash path validator | ❌ gap |
| tools | `tools`, `tool_output.{max_lines,max_bytes,replay_max_chars}`, `experimental.primary_tools`, `experimental.batch_tool` | G/W/S | tool runners | ❌ gap |
| compaction | `compaction.{auto,reserved,full_ratio,force_ratio}` | G/W/S | session/compaction.ts | ❌ gap |
| sharing | `share`, `autoshare`(dep) | G/W/S | share routes | ❌ gap |
| search | `universal_search.{enabled,url}`, `sourcegraph.{enabled,url,token}` | G/W/S | universalsearch backend | ❌ gap |
| server | `server.{username,password,port,host…}` | G | config/server.ts | ❌ gap |
| feature flags | `features.*` (disablePrune, disableAutoCompact, disableMouse, pure, fastBoot…) | G/W/S | feature gates | ❌ gap |
| experimental | `experimental.*` (~20 booleans, config.ts:298-331) | G/W/S | gates | ❌ gap |
| paths | `paths.{gitBashPath,pluginMetaFile,dbPath}` | G/W/S | path overrides | ❌ gap |
| enterprise | `enterprise.url` | G | enterprise routes | ❌ gap |
| formatter/lsp | `formatter`, `lsp` | G/W/S | config/formatter.ts, config/lsp.ts | ❌ gap |
| watcher | `watcher.ignore` | W | file watcher | ❌ gap |
| snapshot/diff | `snapshot`, `diff_requests` | G/W/S | snapshot system; adaptive-client | ❌ gap |
| plugin | `plugin` (Specs) | G/W/S | config/plugin.ts | ❌ gap |

### B. Env variables (grep `process.env.OPENCODE_*` + related, 22 hits)

| Var | Purpose | Dependent code | Layer |
|---|---|---|---|
| `OPENCODE_GATEWAY_LOG_DIR` | gateway log dir override | adaptive-client.ts:187/197/203/441/589/873, gateway/mod.ts:69 | env (over `gateway.logDir`) |
| `OPENCODE_CONFIG_CONTENT` | inline config JSON | config.ts:772-774 | env |
| `OPENCODE_AUTH_CONTENT` | inline auth JSON | auth/index.ts:95-97 | env |
| `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` | server auth | attach.ts:68, run.ts:645-647 | env |
| `OPENCODE_PURE` / `OPENCODE_PID` / `OPENCODE_CLIENT` | process identity | index.ts:98/110, acp.ts:23 | env (system) |
| `OPENCODE_WASM_ROOT` | wasm path override | util/wasm-path.ts:19 | env |
| `OPENCODE_SKIP_MIGRATIONS` | migration guard | storage/migration.ts:71 | env (test) |
| `OPENCODE_TEST_MANAGED_CONFIG_DIR` | managed-config override (test) | config/managed.ts:13 | env (test) |
| `OPENCODE_EDITOR_SSE_PORT` / `CLAUDE_CODE_SSE_PORT` | editor bridge | tui/context/editor.ts:285 | env |
| `OPENCODE_ZED_DB` | zed integration | tui/context/editor-zed.ts:138 | env |
| Provider API keys (ANTHROPIC_*, OPENAI_*, …) | provider auth fallback | provider auth loaders | env |

**Gap:** env vars are undocumented as a settings surface (no registry, no `--env` surfacing in TUI) — bug per policy; subplan 03.

### C. Session settings (session-settings.ts)

`agent[name].{model,variant,subagents}`, `recent`, `favorite`, `variant`, `agentVariant` — session layer. Dependent code: local.tsx (full model/variant plumbing), task.ts/pipeline.ts (`resolveAgentModel`/`resolveAgentVariant`, session-settings.ts:157-203).
**Gap (jsonc):** file is named `.jsonc` but parsed with strict `JSON.parse` (session-settings.ts:229-231) — `//` comments would CRASH the loader. **BUG per policy** → subplan 02.

### D. TUI persisted state (worktree layer)

`model.json` (local.tsx:256-263 snapshot): `recent`, `favorite`, `variant`, `agentVariant`, `workspaceAgent`, `taskModel`. Written via `save()`; loaded at local.tsx:273-292. Strict JSON (no comments) — subplan 02. TUI-editable: ✅ (model/variant/favorite/recent via dialogs; scope-aware since 2026-08-31).

### E. TUI keybinds + tui config

- `config.keybinds` (user-overridable via config file) → keybind.tsx:19; TUI config dialog: dialog-tui-config.tsx (config.keybinds at :42).
- Gap: keybinds editable only by hand-editing config — no TUI editor; mouse support for settings dialogs = click rows only (DialogSelect onMouseUp exists — dialog-select.tsx:339-342); no mouse for scope/variant cycling. Subplan 03.

## Subplans

| File | Scope | State |
|---|---|---|
| [01_global-write.md](01_global-write.md) | global layer editable + confirmation dialog (server handlers + TUI) | IMPLEMENTED 2026-08-31 |
| [02_jsonc-comments.md](02_jsonc-comments.md) | all settings files jsonc with `//` comments (incl. sessions loader jsonc-parser migration) | PLANNED |
| [03_settings-dialog.md](03_settings-dialog.md) | unified Settings dialog: every inventory row editable, scoped, mouse+keyboard; missing setting = bug | PLANNED |

## Smoke tests

- Baseline: `bun run typecheck` (packages/opencode) exit 0.
- Global write: PATCH /global/config on a temp config dir → file gains `agent.X.model`, `//` comments preserved (subplan 01 acceptance).
- Sessions loader: `loadSessionSettings` on a file WITH `//` comments → parses after subplan 02.

## Acceptance criteria (@OUTCOME_CONTRACT)

1. All three layers writable for agent model/variant (global with confirm) — oracle: typecheck + manual TUI flow. ✅ 2026-08-31
2. Settings inventory covers 100% of surfaces (A–E) with dependent code refs — this document.
3. jsonc comments: every settings file loader tolerates `//` — subplan 02.
4. TUI settings option with mouse+keyboard — subplan 03.
5. Policy enforcement: any future setting not added to this registry = bug (review checklist item).
