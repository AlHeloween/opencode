<!-- intention: unmanaged hidden behavior options -> inventoried options with a uniform visible settings surface proposal -->
# t76 — unmanaged options: inventory + uniform surface proposal

<!-- t135 2026-10-22: MOVED to plans/futures/ — class (d): this plan's stated leaf scope is «INVENTORY + PLAN ONLY. No product code», and its deliverable IS delivered: the 88-row inventory (where-read / effect / default / class+reason / visible / changeable), the reuse-first `/settings` proposal, the hardcoded-threshold table and the smoke tests S1–S5. It carries NO executable box, so the status surface could never see it — the debt counter read it as «no checklist». The one open item it names — «A3 owner decision outstanding: which USER rows get surfaced first» — is a DECISION, not a task. CONDITION: this file resumes as a NEW executable plan when the owner names the first USER rows to surface; the surface work then becomes a plan with boxes, the S1–S5 oracles and concrete bindings (config keys for GRAPH_FIRST / DOC_READ_GATE / STOP_CHECK / CODEGRAPH_MCP, the editable kinds, the display-only threshold rows). Receipt: the inventory and the proposal are this file; the commit that landed it is `a36f434dfe` («t76 unmanaged options: 88-row inventory + /settings reuse proposal (plan only)»); the terminal is named by the owner's rule «План делается чтобы его сделать, для глобальной разработки есть мастерплан» (2026-10-22) — direction lives in the master plan and in futures, work lives in a plan. -->
Owner verbatim (2026-10-16): «Смотри получается что есть опции которые не управляемые, это не есть гуд.»

Leaf scope: INVENTORY + PLAN ONLY. No product code. No `bin/`, no kernel, no edits to t68 files.
t68 owns: the model chain, the favorites↔chain link, the attempt display
(`GET/PUT /chain/:scope/:agent`, session ses_ebcfd864fffeu2VL5oSMQUA6mU, busy).
This plan names them as «owned by t68» and does not design them.

## Ground (G1, in the tasked order)

1. codegraph first — `codegraph serve --mcp` + SQLite pack, query
   `config settings layers store fill-once TUI settings dialogs` and
   `settings registry dialog-settings layer-inherit TUI config store`.
   Store: fill-once layers, never resolve at read time —
   `packages/opencode/src/cli/cmd/tui/component/layer-inherit.ts:1-20`
   (owner ruling 2026-09-19, quoted there); `docs/storage-paradigm.md:1-62`
   (two planes: SQLite relational, LMDB fast; fill, do not resolve).
2. TUI settings surfaces that exist today:
   - `/settings` — `packages/opencode/src/cli/cmd/tui/component/dialog-settings.tsx:1-298`,
     rows from `packages/opencode/src/cli/cmd/tui/settings/registry.ts:1-259`
     (`SETTINGS_REGISTRY = configRows + sessionRows + modelStateRows + envRows`).
     Config rows are GENERATED from `Config.Info` schema (`configRows():178-204`);
     coverage test enforces zero diff (`test/tui/settings-registry.test.ts`).
     Writes reuse existing plumbing only: worktree `PATCH /config` (RFC 7386
     minimal subtree), global `PATCH /global/config` (get→set→update, confirm first).
     Session/model-state rows are read-only pointers at `/agents`, `/model`.
     Env rows (`envRows():239-251`) are read-only display via `envValue():257-259`.
   - `/agents`, `/model`, `/task-settings`, `/subagent-settings` — session-scope
     model/variant/subagents/task-model edits (own dialogs, not `/settings`).
   - `DialogTuiConfig` — `packages/opencode/src/cli/cmd/tui/ui/dialog-tui-config.tsx:15-86`
     read-only view of `tui.json` (theme, scroll, diff style, mouse, image protocol).
   - `/rules`, `/skills`, `/tools` — `dialog-feature-toggle.tsx:1-187` (PATCH /config minimal subtree).
   - `DialogRouting`, `DialogModelParameters`, `DialogProvider`, `DialogMcp` — per-surface editors.
3. Env reads — 88 distinct `OPENCODE_*` names in `packages/opencode/src` (`*.ts`),
   confirmed by enumeration on this host (same count the task states).
   Two read mechanisms: `Flag` (`packages/core/src/flag/flag.ts:1-141` —
   `truthy`/`falsy`/`number` + `_configValues` cache from `Flag.fromConfig()`,
   getters check config first, then env) and direct `process.env[...]` reads
   (opt-out gates, plumbing, IPC). Deprecated-but-live mapping
   `ENV_TO_CONFIG_MAP` (`packages/opencode/src/config/config.ts:1188-1249`,
   applied by `applyEnvOverrides():1271-1281` with a `log.warn` migrate nudge).
   Removed vars are named in the comment at `config.ts:1180-1186`.
   Names only were read — no VALUES were inspected or printed (task rule).
4. API-only behavior routes — `GET/PUT /chain/:scope/:agent`
   (`packages/opencode/src/server/routes/instance/httpapi/chain.ts:8-13,42-65`,
   owned by t68); `PATCH /config`, `PATCH /global/config`
   (`httpapi/global.ts`, `httpapi/config` bridge routes, used by `/settings`);
   session/config/model-state writes via `/agents`, `/model` dialogs.
5. Hardcoded thresholds — `FIRST_TOKEN_FLOOR_MS = 120_000`
   (`packages/opencode/src/provider/model-chain/classify.ts:43`, measured
   2026-10-16, comment lines 30-42), `FIRST_TOKEN_P50_MULTIPLE = 3` (`:45`),
   retry policy (`packages/opencode/src/session/retry.ts:17-22`:
   `EMPTY_RESPONSE_MAX_ATTEMPTS = 5`, `RETRY_INITIAL_DELAY = 2000`,
   `RETRY_BACKOFF_FACTOR = 2`, `RETRY_MAX_DELAY_NO_HEADERS = 30_000`).

AGENTS.md invariant applied: «Absence of an oracle reads as FALSE» — every value
below must always render, including `default`/`(unset)`. A hidden option is a hidden oracle.

## Counts

- PLUMBING: 30 — process/test wiring; stays env.
- USER: 45 — behavior the owner should see and flip.
- DEV: 7 — debug/diagnostic toggle; stays env.
- DEAD: 6 — read nowhere that matters, or upstream residue.
- Total: 88. Chain rows + hardcoded rows are extra tables, not in the 88.

## Inventory — 88 env rows

Columns: name | where it is read (path:line) | what it changes | default |
class + reason | visible in TUI today (Y/N + surface) | changeable there (Y/N).

Effective-value rule used for visible/changeable: a var with a config path
(`ENV_TO_CONFIG_MAP`) is visible as its config row in `/settings` (Y) and
changeable through that row when its kind is editable (boolean/enum/string/number/model = Y,
json = N — registry `classify():149-167`, `readOnly = kind == json` at `:190`).
A var in `ENV_VARS` (`registry.ts:129-145`) is visible as a read-only env row (Y) but
never changeable there (N). Anything else is N/N.

### USER — 45 (behavior the owner should see and flip)

| name | where read | what it changes | default | class + reason | visible | changeable |
|---|---|---|---|---|---|---|
| OPENCODE_AUTO_SHARE | packages/core/src/flag/flag.ts:47; packages/opencode/src/config/config.ts:1210 | features.autoShare — automatic sharing switch (deprecated path) | unset/false | USER — sharing behavior the owner flips per conversation/project | Y (/settings config.features group) | Y (boolean row → PATCH /config) |
| OPENCODE_BYPASS_CONSTITUTION | packages/opencode/src/config/config.ts:1248; packages/opencode/src/session/constitution.ts:894 | bypass_constitution — skips hard-blocks on fossil/git destructive commands | unset (blocks enforced) | USER — dangerous but owner-visible safety switch; surfacing it makes the danger explicit | Y (/settings Permissions group) | Y (with confirm policy for global) |
| OPENCODE_CODEGRAPH_MCP | packages/opencode/src/config/codegraph-mcp-auto.ts:46; packages/opencode/src/config/config.ts:924 | codegraph MCP auto-enable opt-out (`=0/false` disables) | enabled | USER — decides whether structural grounding exists at all | N (no config path, no env row) | N |
| OPENCODE_DISABLE_AUTOCOMPACT | packages/core/src/flag/flag.ts:60; packages/opencode/src/config/config.ts:1196 | features.disableAutoCompact — auto-compaction on/off | false (compaction on) | USER — conversation continuity behavior | Y (/settings Compaction/Features) | Y |
| OPENCODE_DISABLE_CHANNEL_DB | packages/core/src/flag/flag.ts:105; packages/opencode/src/config/config.ts:1207 | features.disableChannelDb — channel persistence on/off | false | USER — changes whether channel state persists | Y (/settings) | Y |
| OPENCODE_DISABLE_CLAUDE_CODE | packages/core/src/flag/flag.ts:63; packages/opencode/src/config/config.ts:1202 | features.disableClaudeCode — Claude Code integration master | false | USER — visible integration on/off | Y (/settings) | Y |
| OPENCODE_DISABLE_CLAUDE_CODE_PROMPT | packages/core/src/flag/flag.ts:64; packages/opencode/src/config/config.ts:1203 | features.disableClaudeCodePrompt — Claude Code prompt injection | false | USER — prompt behavior the owner flips | Y (/settings) | Y |
| OPENCODE_DISABLE_CLAUDE_CODE_SKILLS | packages/core/src/flag/flag.ts:65; packages/opencode/src/config/config.ts:1204 | features.disableClaudeCodeSkills (+ implies disableExternalSkills) | false | USER — skill surface on/off | Y (/settings) | Y |
| OPENCODE_DISABLE_DEFAULT_PLUGINS | packages/core/src/flag/flag.ts:57; packages/opencode/src/config/config.ts:1198 | features.disableDefaultPlugins | false | USER — plugin surface on/off | Y (/settings) | Y |
| OPENCODE_DISABLE_EMBEDDED_WEB_UI | packages/core/src/flag/flag.ts:103; packages/opencode/src/config/config.ts:1206 | features.disableEmbeddedWebUI | false | USER — web UI surface on/off | Y (/settings) | Y |
| OPENCODE_DISABLE_EXTERNAL_SKILLS | packages/core/src/flag/flag.ts:66; packages/opencode/src/config/config.ts:1205 | features.disableExternalSkills | false | USER — external skill loading on/off | Y (/settings) | Y |
| OPENCODE_DISABLE_LSP_DOWNLOAD | packages/core/src/flag/flag.ts:58; packages/opencode/src/config/config.ts:1199 | features.disableLspDownload | false | USER — network fetch behavior for LSP | Y (/settings) | Y |
| OPENCODE_DISABLE_MODELS_FETCH | packages/core/src/flag/flag.ts:61; packages/opencode/src/config/config.ts:1200 | features.disableModelsFetch — catalog sync on/off | false | USER — network + freshness behavior | Y (/settings) | Y |
| OPENCODE_DISABLE_MOUSE | packages/core/src/flag/flag.ts:62; packages/opencode/src/config/config.ts:1201 | features.disableMouse — TUI mouse capture | false | USER — directly felt TUI behavior | Y (/settings) | Y |
| OPENCODE_DISABLE_PROJECT_CONFIG | packages/core/src/flag/flag.ts:114; packages/opencode/src/config/config.ts:1208; packages/opencode/src/config/paths.ts:29 | features.disableProjectConfig — project config loading | false | USER — decides which layers exist | Y (/settings) | Y |
| OPENCODE_DISABLE_PRUNE | packages/core/src/flag/flag.ts:53; packages/opencode/src/config/config.ts:1195 | features.disablePrune — prune step on/off | false | USER — context/retention behavior (task-named example) | Y (/settings) | Y |
| OPENCODE_DISABLE_SHARE | packages/core/src/flag/flag.ts:105 area; packages/opencode/src/config/config.ts:1209 | features.disableShare | false | USER — sharing surface on/off | Y (/settings) | Y |
| OPENCODE_DISABLE_TERMINAL_TITLE | packages/core/src/flag/flag.ts:54; packages/opencode/src/config/config.ts:1197 | features.disableTerminalTitle | false | USER — terminal chrome behavior | Y (/settings) | Y |
| OPENCODE_DOC_READ_GATE | packages/opencode/src/session/doc-read.ts:19,34 | doc-read gate opt-out (`=0/false/off/no` disables the read-tool route) | gate on | USER — agent discipline gate; the owner ordered the behavior, so the switch must be visible | N (no config path, no env row) | N |
| OPENCODE_ENABLE_EXA | packages/core/src/flag/flag.ts:86; packages/opencode/src/config/config.ts:1228 | experimental.exa — Exa search tool | false | USER — tool availability the owner flips | Y (/settings Tools & Features) | Y |
| OPENCODE_ENABLE_EXPERIMENTAL_MODELS | packages/core/src/flag/flag.ts:59; packages/opencode/src/config/config.ts:1231 | experimental.experimentalModels | false | USER — model catalog surface | Y (/settings) | Y |
| OPENCODE_ENABLE_QUESTION_TOOL | packages/core/src/flag/flag.ts:70; packages/opencode/src/config/config.ts:1230 | experimental.questionTool | false | USER — owner-decision tool availability | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL | packages/core/src/flag/flag.ts:76; packages/opencode/src/config/config.ts:1215 | experimental.masterSwitch — enables the experimental family | false | USER — master behavior switch | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS | packages/core/src/flag/flag.ts:87; packages/opencode/src/config/config.ts:1232 | experimental.bashTimeoutMs — default bash timeout | schema default | USER — timeout the owner tunes per host | Y (/settings) | Y (number row) |
| OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT | packages/core/src/flag/flag.ts:84; packages/opencode/src/config/config.ts:1221 | experimental.disableCopyOnSelect (win32 defaults true) | platform-dependent | USER — clipboard/TUI behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER | packages/core/src/flag/flag.ts:80; packages/opencode/src/config/config.ts:1217 | experimental.disableFileWatcher | false | USER — watcher behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_EVENT_SYSTEM | packages/opencode/src/config/config.ts:1226 | experimental.eventSystem | false | USER — event pipeline behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_EXA | packages/core/src/flag/flag.ts:86; packages/opencode/src/config/config.ts:1229 | experimental.exa alias | false | USER — same surface as ENABLE_EXA, alias kept for compat | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_FILEWATCHER | packages/core/src/flag/flag.ts:77; packages/opencode/src/config/config.ts:1216 | experimental.fileWatcher | false | USER — watcher behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_ICON_DISCOVERY | packages/core/src/flag/flag.ts:83; packages/opencode/src/config/config.ts:1220 | experimental.iconDiscovery | false | USER — TUI icon behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_LSP_TOOL | packages/core/src/flag/flag.ts:90; packages/opencode/src/config/config.ts:1222 | experimental.lspTool | false | USER — LSP tool availability | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_NATIVE_LLM | packages/opencode/src/config/config.ts:1225 | experimental.nativeLlm | false | USER — inference path switch | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX | packages/core/src/flag/flag.ts:88; packages/opencode/src/config/config.ts:1233 | experimental.outputTokenMax — output token cap | schema default | USER — cost/quality knob the owner tunes | Y (/settings) | Y (number row) |
| OPENCODE_EXPERIMENTAL_OXFMT | packages/core/src/flag/flag.ts:89; packages/opencode/src/config/config.ts:1223 | experimental.oxfmt — formatter switch | false | USER — formatting behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_PLAN_MODE | packages/core/src/flag/flag.ts:91; packages/opencode/src/config/config.ts:1218 | experimental.planMode | false | USER — planning behavior switch (task-named area) | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_WEBSOCKETS | packages/opencode/src/config/config.ts:1224 | experimental.websockets — transport switch | false | USER — transport behavior | Y (/settings) | Y |
| OPENCODE_EXPERIMENTAL_WORKSPACES | packages/core/src/flag/flag.ts:110; packages/opencode/src/config/config.ts:1227 | experimental.workspaces | false | USER — workspace surface on/off | Y (/settings) | Y |
| OPENCODE_FAST_BOOT | packages/opencode/src/config/config.ts:1213 | features.fastBoot — fast vs complete boot | false | USER — startup behavior tradeoff | Y (/settings) | Y |
| OPENCODE_GRAPH_FIRST | packages/opencode/src/session/graph-first.ts:21,47 | graph-first gate opt-out (`=0/false/off/no`) | gate on | USER — agent search discipline; owner finding 2026-10-15, must be flippable without env | N (no config path, no env row) | N |
| OPENCODE_MARKDOWN | packages/core/src/flag/flag.ts:98; packages/opencode/src/config/config.ts:1219; packages/opencode/src/cli/cmd/tui/settings/registry.ts:144 | experimental.markdown — TUI markdown rendering, MUST default true | true | USER — rendering behavior; AGENTS.md pins default true | Y (/settings env row, read-only) | N (row is read-only today — part of the proposal to make it editable) |
| OPENCODE_PERMISSION | packages/core/src/flag/flag.ts:56; packages/opencode/src/config/config.ts:903 | permission JSON merge into config.permission | unset | USER — permission policy the owner authors | Y (/settings Permissions; kind may be json → read-only pointer today) | N/Y by kind (see proposal) |
| OPENCODE_PURE | packages/core/src/flag/flag.ts:123; packages/opencode/src/config/config.ts:1211; packages/opencode/src/cli/cmd/tui/settings/registry.ts:135 | features.pure — no user state | false | USER — isolation behavior (fresh-state runs) | Y (/settings: config row + read-only env row) | Y via config row |
| OPENCODE_SELF_EDIT_DIRECTIVE | packages/opencode/src/session/self-edit.ts:66; packages/core/src/flag/flag.ts:73; packages/opencode/src/session/message-v2.ts:1058,1972 | agent self-edit of its own replayed representation (t70); OFF unless `true/1` | off | USER — agent memory behavior; task-named example; Flag already has fromConfig bridge so it is surfacing-ready | N (bridge exists, no schema key, no env row) | N |
| OPENCODE_STOP_CHECK | packages/opencode/src/session/stop-check.ts:27,97 | stop-check gate opt-out (`=0/false/off/no`) | gate on | USER — turn-exit discipline the owner ordered; must be flippable in TUI | N (no config path, no env row) | N |
| OPENCODE_TERMINAL | packages/opencode/src/config/config.ts:1246; packages/opencode/src/pty/index.ts:216 | terminal.mode | schema default | USER — terminal surface mode | Y (/settings Terminal group) | Y |

### PLUMBING — 30 (process/test wiring; stays env)

| name | where read | what it changes | default | class + reason | visible | changeable |
|---|---|---|---|---|---|---|
| OPENCODE_AUTH_CONTENT | packages/opencode/src/auth/index.ts; packages/opencode/src/config/config.ts:1181 | inline auth JSON overriding the auth file (IPC/bootstrap) | unset | PLUMBING — inter-process wiring, per-launch secret transport | Y (/settings env row, read-only) | N |
| OPENCODE_CALLER | packages/opencode/src/config/config.ts:1183 | caller marker for tests | unset | PLUMBING — test wiring | N | N |
| OPENCODE_CLIENT | packages/core/src/flag/flag.ts:129; packages/opencode/src/config/config.ts:1193 | client.type identity marker | `cli` | PLUMBING — process identity, set by launcher | Y (/settings env row, read-only) | N |
| OPENCODE_CONFIG | packages/core/src/flag/flag.ts:50; packages/opencode/src/config/config.ts:747 | custom config file path | unset | PLUMBING — bootstrap path, per-launch | N | N |
| OPENCODE_CONFIG_CONTENT | packages/core/src/flag/flag.ts:51; packages/opencode/src/config/config.ts:824; packages/opencode/src/cli/cmd/tui/settings/registry.ts:130 | inline config JSON overriding files | unset | PLUMBING — bootstrap/IPC transport | Y (/settings env row, read-only) | N |
| OPENCODE_CONFIG_DIR | packages/core/src/flag/flag.ts:120; packages/opencode/src/config/config.ts:772 | highest-priority config source dir | unset | PLUMBING — bootstrap path, per-machine | N | N |
| OPENCODE_CONSOLE_TOKEN | packages/opencode/src/config/config.ts:847 | console token IPC | unset | PLUMBING — inter-process secret | N | N |
| OPENCODE_DB | packages/core/src/flag/flag.ts:104; packages/opencode/src/config/config.ts:1244 | paths.dbPath override | schema default | PLUMBING — host path wiring | N | N |
| OPENCODE_EDITOR_SSE_PORT | packages/opencode/src/config/config.ts:1183 | editor bridge SSE port | unset | PLUMBING — test/port wiring | Y (/settings env row, read-only) | N |
| OPENCODE_GATEWAY_LOG_DIR | packages/opencode/src/cli/cmd/tui/settings/registry.ts:134; packages/opencode/src/config/config.ts:1239 | gateway.logDir override | schema default | PLUMBING — host log path, per-launch | Y (/settings env row, read-only) | N |
| OPENCODE_GIT_BASH_PATH | packages/core/src/flag/flag.ts:49; packages/opencode/src/config/config.ts:1242 | paths.gitBashPath — host git-bash location | unset | PLUMBING — host toolchain path | N | N |
| OPENCODE_LIBC | packages/opencode/src/file/watcher.ts:17,35 | parcel watcher libc variant (`glibc`/other) on linux | `glibc` | PLUMBING — toolchain wiring, not behavior | N | N |
| OPENCODE_MODELS_PATH | packages/core/src/flag/flag.ts:102; packages/opencode/src/config/config.ts:1241 | paths.modelsPath — catalog file location | schema default | PLUMBING — host path wiring | N | N |
| OPENCODE_MODELS_URL | packages/core/src/flag/flag.ts:101; packages/opencode/src/config/config.ts:1240 | paths.modelsUrl — catalog source URL | schema default | PLUMBING — network source wiring | N | N |
| OPENCODE_PID | packages/opencode/src/index.ts; packages/opencode/src/cli/cmd/tui/settings/registry.ts:136 | process identity marker | unset | PLUMBING — process wiring | Y (/settings env row, read-only) | N |
| OPENCODE_PLUGIN_META_FILE | packages/core/src/flag/flag.ts:126; packages/opencode/src/config/config.ts:1243 | paths.pluginMetaFile location | schema default | PLUMBING — host path wiring | N | N |
| OPENCODE_PORT | packages/opencode/src/config/config.ts:1184 | port marker for tests | unset | PLUMBING — test wiring | N | N |
| OPENCODE_PROCESS_ROLE | packages/opencode/src/config/config.ts:1182 area | process role IPC marker | unset | PLUMBING — multiprocess wiring | N | N |
| OPENCODE_ROUTE | packages/opencode/src/config/config.ts:1184 | route marker for tests | unset | PLUMBING — test wiring | N | N |
| OPENCODE_RUN_ID | packages/opencode/src/config/config.ts:1182 area | run id IPC marker | unset | PLUMBING — process wiring | N | N |
| OPENCODE_SERVER_PASSWORD | packages/core/src/flag/flag.ts:68; packages/opencode/src/config/config.ts:1190; packages/opencode/src/cli/cmd/tui/settings/registry.ts:132 | server.password (headless auth secret) | unset | PLUMBING — secret transport; must never become an editable settings row | Y (/settings env row, read-only) | N |
| OPENCODE_SERVER_USERNAME | packages/core/src/flag/flag.ts:69; packages/opencode/src/config/config.ts:1191 | server.username (headless auth) | unset | PLUMBING — auth wiring | Y (/settings env row, read-only) | N |
| OPENCODE_SKIP_MIGRATIONS | packages/opencode/src/cli/cmd/tui/settings/registry.ts:139; packages/opencode/src/config/config.ts:1183 | skip storage migrations (test) | unset | PLUMBING — test wiring | Y (/settings env row, read-only) | N |
| OPENCODE_TEST_ | packages/opencode/src/config/config.ts:1183 | `OPENCODE_TEST_*` prefix — test-only vars | unset | PLUMBING — test namespace | N | N |
| OPENCODE_TEST_MANAGED_CONFIG_DIR | packages/opencode/src/config/managed.ts; packages/opencode/src/cli/cmd/tui/settings/registry.ts:140 | managed-config override for tests | unset | PLUMBING — test wiring | Y (/settings env row, read-only) | N |
| OPENCODE_TUI_CONFIG | packages/core/src/flag/flag.ts:117; packages/opencode/src/config/config.ts:1180 | TUI config file path | unset | PLUMBING — bootstrap path | N | N |
| OPENCODE_WASM_ROOT | packages/opencode/src/util/wasm-path.ts; packages/opencode/src/cli/cmd/tui/settings/registry.ts:138 | WASM assets path override | unset | PLUMBING — asset path wiring | Y (/settings env row, read-only) | N |
| OPENCODE_WORKER_PATH | packages/opencode/src/cli/cmd/tui/thread.ts | worker script path | unset | PLUMBING — process wiring | N | N |
| OPENCODE_WORKSPACE_ID | packages/core/src/flag/flag.ts:108; packages/opencode/src/config/config.ts:1181 | workspace id IPC marker | unset | PLUMBING — multiprocess wiring | N | N |
| OPENCODE_ZED_DB | packages/opencode/src/config/config.ts:1183 | Zed integration DB path | unset | PLUMBING — test/integration wiring | Y (/settings env row, read-only) | N |

### DEV — 7 (debug/diagnostic toggle; stays env)

| name | where read | what it changes | default | class + reason | visible | changeable |
|---|---|---|---|---|---|---|
| OPENCODE_ALLOW_DESTRUCTIVE | packages/opencode/src/session/constitution.ts | allows destructive-file effects past the constitution gate | unset (denied) | DEV — dangerous diagnostic override for bisecting a block, not a daily switch | N | N |
| OPENCODE_AUTO_HEAP_SNAPSHOT | packages/core/src/flag/flag.ts:48; packages/opencode/src/config/config.ts:1236; packages/opencode/src/cli/heap.ts | debug.autoHeapSnapshot — automatic heap capture | false | DEV — memory diagnostics | N (config row exists but group is debug; surface proposal leaves it env-only until a diagnostics panel exists) | N via TUI today |
| OPENCODE_BYPASS_GROUNDING | packages/opencode/src/session/constitution.ts:1651 | bypasses the grounding gate (`=1`) | unset | DEV — diagnostic bypass for harness work | N | N |
| OPENCODE_FAKE_VCS | packages/core/src/flag/flag.ts:67; packages/opencode/src/config/config.ts:1237 | debug.fakeVcs — fake VCS surface | unset | DEV — test/debug double | N | N |
| OPENCODE_SHOW_TTFD | packages/core/src/flag/flag.ts:55; packages/opencode/src/config/config.ts:1235 | debug.showTTFD — TTFD display | false | DEV — timing diagnostic | N | N |
| OPENCODE_STRICT_CONFIG_DEPS | packages/core/src/flag/flag.ts:106; packages/opencode/src/config/config.ts:1212 | features.strictConfigDeps — strict config dependency check | false | DEV — config-hygiene diagnostic | Y (/settings config row) | Y (stays editable as config, but classified DEV because only diagnostics consume it) |
| OPENCODE_STRICT_WORKER | packages/opencode/src/cli/cmd/tui/worker.ts:36,40 | `=1` restores old kill for bisecting a hang | unset (soft handling) | DEV — hang-bisect diagnostic | N | N |

### DEAD — 6 (read nowhere that matters, or upstream residue)

| name | where read | what it changes | default | class + reason | visible | changeable |
|---|---|---|---|---|---|---|
| OPENCODE_ALLOW_DOWNGRADE | packages/opencode/src/config/config.ts:1185 (removed-var comment only) | nothing — removed | n/a | DEAD — named only in the removed-vars comment, no live read | N | N |
| OPENCODE_DISABLE_AUTOUPDATE | packages/opencode/src/config/config.ts:1185 (removed-var comment only) | nothing — removed | n/a | DEAD — same, no live read | N | N |
| OPENCODE_ALWAYS_NOTIFY_UPDATE | packages/opencode/src/config/config.ts:1186 (removed-var comment only) | nothing — removed | n/a | DEAD — same, no live read | N | N |
| OPENCODE_MIGRATIONS | packages/opencode/src/config/config.ts:1186 (removed-var comment only) | nothing — removed | n/a | DEAD — same, no live read | N | N |
| OPENCODE_STREAM_STALL_TIMEOUT_MS | packages/opencode/src/config/config.ts:1186 (removed-var comment only) | nothing — removed (task-named example, now residue) | n/a | DEAD — removed; if a stall knob returns it must come back as a config key, not this name | N | N |
| OPENCODE_SKILL_PATTERN | packages/opencode/src/skill/index.ts:19 (`const OPENCODE_SKILL_PATTERN`, not an env read) | nothing env-driven — glob constant `{skill,skills}/**/SKILL.md` | constant | DEAD — grep false positive: a constant whose name matches the pattern, never `process.env`/`Flag` | N | N |

## API-only behavior routes (not env; owned-by-t68 marked)

| route | where | what it changes | visible in TUI | note |
|---|---|---|---|---|
| `GET /chain/:scope/:agent` | packages/opencode/src/server/routes/instance/httpapi/chain.ts:42 | reads ONE layer's explicit model chain + per-member health; no parent consulted | N | owned by t68 — do not touch |
| `PUT /chain/:scope/:agent` | packages/opencode/src/server/routes/instance/httpapi/chain.ts:53 | replaces ONE layer's explicit model chain (primary + backups); the route the TUI dialog and web form share | N (no TUI caller today) | owned by t68 — do not touch |
| `PATCH /config` (worktree) | dialog-settings.tsx:145-150, dialog-feature-toggle.tsx:72-74 | minimal RFC 7386 subtree write to the project config | Y (behind /settings, /rules, /skills, /tools edits) | reuse for USER surface — no new endpoint |
| `PATCH /global/config` | dialog-settings.tsx:152-184 | global config write (confirm-first policy) | Y (behind /settings global scope) | reuse for USER surface — no new endpoint |
| session/model-state writes | `/agents`, `/model` dialogs; session-settings.ts:548 | per-agent model/variant/subagents/routing/sampling overrides | Y (own dialogs) | stays where it is; USER surface points at it, does not duplicate it |

## Hardcoded thresholds that steer behavior (invisible today)

| name | where | value | note |
|---|---|---|---|
| FIRST_TOKEN_FLOOR_MS | packages/opencode/src/provider/model-chain/classify.ts:43 | 120_000 ms (~2.4x observed max, comment :30-42) | t68-owned semantics; surfacing = read-only display first, edit only with t68 |
| FIRST_TOKEN_P50_MULTIPLE | packages/opencode/src/provider/model-chain/classify.ts:45 | 3 | same as above |
| firstTokenTimeoutMs derived | classify.ts:108-111; failover.ts:75 | `max(FLOOR, 3 × p50)` | derived, display the inputs + result |
| EMPTY_RESPONSE_MAX_ATTEMPTS | packages/opencode/src/session/retry.ts:17 | 5 | retry budget — DEV/USER borderline; display first |
| RETRY_INITIAL_DELAY | packages/opencode/src/session/retry.ts:19 | 2000 ms | same |
| RETRY_BACKOFF_FACTOR | packages/opencode/src/session/retry.ts:20 | 2 | same |
| RETRY_MAX_DELAY_NO_HEADERS | packages/opencode/src/session/retry.ts:21 | 30_000 ms | same |

## Proposal — the smallest uniform surface for the USER class

Reuse, do not invent:

1. Extend the existing `/settings` dialog (`dialog-settings.tsx` + `registry.ts`) —
   no new dialog, no new route, no new store. It already renders every value always
   (`preview():109-115` prints `(unset)`/value, never blank — the AGENTS.md oracle rule)
   and already writes through the settings store
   (`PATCH /config`, `PATCH /global/config`).
2. For each USER row that already has a config path: keep the generated config row;
   fix kinds where the row is `json`/read-only but the value is safely editable
   (`permission`, `bypass_constitution` text) into an editable kind or a validated
   string editor — still through the same two PATCH paths.
3. For each USER row with NO config path today
   (`OPENCODE_GRAPH_FIRST`, `OPENCODE_DOC_READ_GATE`, `OPENCODE_STOP_CHECK`,
   `OPENCODE_CODEGRAPH_MCP`, `OPENCODE_SELF_EDIT_DIRECTIVE` already bridged):
   add a real config schema key (e.g. `features.graphFirst`, `features.docReadGate`,
   `features.stopCheck`, `features.codegraphMcp`, `features.selfEditDirective`),
   thread it through `Flag.fromConfig()` exactly like `OPENCODE_SELF_EDIT_DIRECTIVE`
   (`flag.ts:73`) so config-first/env-fallback holds, extend `ENV_TO_CONFIG_MAP`
   for back-compat, and let the registry generate the row automatically.
   Defaults render explicitly (`gate on`, `off unless true/1`, `enabled`) — never blank.
4. `OPENCODE_MARKDOWN`: flip its env row from read-only display to the editable
   config row (`experimental.markdown`) as the single source; keep the pin
   (default true, AGENTS.md Markdown Rendering Flag).
5. Hardcoded thresholds: display-only rows first (value + provenance comment),
   editable only with the owning plan's approval (chain/failover numbers with t68).
6. PLUMBING/DEV stay env-only and stay out of `/settings` except the 15 existing
   read-only env rows (secrets included — display, never edit).
   DEAD names are removed from comments/docs, never surfaced.

Why this is the smallest: one dialog, zero new endpoints, zero new state planes
(fill-once layers + existing PATCH paths unchanged); the registry coverage test
keeps «a setting that exists but is absent here is a bug» true by construction.

## Smoke Tests

- S1 registry coverage: `test/tui/settings-registry.test.ts` — every USER config key
  appears in `SETTINGS_REGISTRY` with the intended kind/group; fails on a missing row.
- S2 dialog render: `/settings` renders every USER row with a non-blank preview,
  including `default`/`(unset)` (oracle rule); screenshot or `verify_state` on the dialog.
- S3 worktree write: flip one USER boolean in worktree scope → `PATCH /config`
  minimal subtree → re-GET shows the value; global write still requires confirm.
- S4 opt-out parity: each newly bridged gate (`GRAPH_FIRST`, `DOC_READ_GATE`,
  `STOP_CHECK`, `CODEGRAPH_MCP`, `SELF_EDIT_DIRECTIVE`) behaves identically via
  config key and via env fallback; env set + config unset still honors env.
- S5 no-regression: PLUMBING/DEV names remain settable via env and unchanged in
  behavior; DEAD names set in env change nothing (assert no read).

## Risks

- R1 scope touch with t68: chain routes and failover numbers are t68-owned —
  containment: read-only display, no edits, name t68 in the row.
- R2 secret handling: `SERVER_PASSWORD`/`SERVER_USERNAME`/`AUTH_CONTENT` display only,
  never editable, never logged — containment: keep `readOnly: true`, no value capture.
- R3 layer pollution: writing merged config back drags global into project —
  containment: minimal-subtree PATCH only (existing rev-2 rule, dialog-settings.tsx:145-150).
- R4 global blast radius: containment: existing confirm-first policy for global writes.

## Acceptance

- A1 inventory complete: 88 rows, each with where-read, effect, default, class+reason,
  visible/changeable — this file.
- A2 surface named: `/settings` extension, zero new endpoints, smoke tests S1–S5 named.
- A3 owner decision outstanding: which USER rows get surfaced first (STOP, report counts).

```yaml
Keywords: unmanaged-options 0.30, settings-registry 0.25, env-inventory 0.20, tui-surface 0.15, plan-only 0.10
Semantic dominant: Inventory of 88 hidden behavior options with a reuse-first uniform settings surface proposal.
md5: 7f3a9c1e4b5d6a8c9e0f1a2b3c4d5e6f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```
