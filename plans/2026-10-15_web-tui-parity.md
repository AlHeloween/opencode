<!-- intention: browser form shows only part of what the TUI shows (no active-sessions block, no sidebar status rows, no scoped agent/model write path) -> the web app reaches parity surface by surface through the SAME server routes/events the TUI uses, with a measured parity table and a value-or-unknown invariant on every status -->
<!-- goal_sv:
Keywords: web-tui-parity 0.35, same-server-source 0.25, active-sessions-web 0.20, status-or-unknown 0.20
Semantic dominant: The browser form shows everything the TUI shows by reading the same server data, starting with the active-sessions block the owner needs to not kill a running session.
md5: 9f3a7c2d1e4b4f6a8d2c5e7f1a3b4c5d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->
<!-- subgoal: s3-surfaces-agent-sees-drives — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S3 -->

# t59 — web/TUI parity: the browser form shows everything the TUI shows

Owner, 2026-10-15, verbatim: «у тебя же браузер есть кстати, пока оставь tui, и надо бы сделать так чтобы браузерная
форма отображала все что у нас в tui есть».

Rule for this task: work in `D:\zPython\opencode` on branch `Local_Development`. No checkout, no worktree.
Commit ONLY own paths (`git add <path>…`, never `-A`). `_progress_log.md` is shared — append, keep BOTH entries
on conflict. Tests from `packages/opencode`, ONE file per call, through cmd_runner; read `state.json` + whole output.
Never bare `bun test`. A red test is first a question about the TEST (AGENTS.md § Bug Policy). Never touch `bin/`.
Never `--no-verify`. Bounds: steps 100, tools 220, loops 4, depth 2, time 7 200 000 ms.

## G1 grounding — where each surface gets its data (measured 2026-10-15)

Serving: the server serves the web app itself — `packages/opencode/src/server/routes/ui.ts:19-55`
(`UIRoutes`: embedded `opencode-web-ui.gen.ts` when built, else proxy `https://app.opencode.ai`).
The web app talks to the SAME instance httpapi as the TUI (`packages/app/src/context/sdk.tsx`,
`global-sdk.tsx`, `sync.tsx`) — no second source by construction. Local persist
(`packages/app/src/utils/persist.ts:311-323`) is cache, not source.

TUI store sync: `packages/opencode/src/cli/cmd/tui/context/sync.tsx:623-626` (`case "session.status"` →
`setStore("session_status", …)`), bootstrapped `:964-966` (`sdk.client.session.status` → reconcile);
session list from `session.list` (`:944-951`). Server side: `GET session.status`
(`packages/opencode/src/server/routes/instance/httpapi/session.ts:168-176`, StatusMap) + SSE
`GET /global/event` (`packages/sdk/js/src/v2/gen/sdk.gen.ts:305-310`). The TUI t52 block's data path is
spelled out in `plans/2026-10-15_tui-active-sessions-panel.md:15-33`.

t52 state (measured, not guessed): the TUI block EXISTS in the worktree but is UNTRACKED and UNCOMMITTED —
`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/active-sessions.ts` (rows, `??` in git status),
`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/sessions.tsx:22-108` (view, order 50),
wired in `packages/opencode/src/cli/cmd/tui/plugin/internal.ts:9,28`, test at
`packages/opencode/test/tui/sidebar-active-sessions.test.tsx` (`??`). It belongs to the t52 robot working
in this same tree: DO NOT stage, edit, or commit those paths from this task. The web block built here
reuses the same row semantics against the same `session.status` source.

## Deliverable 1 — parity table (measured, not guessed)

| # | TUI surface (file:line) | Data source (route/event/store key) | Web status | Web file:line |
|---|---|---|---|---|
| 1 | Active Sessions block `tui/feature-plugins/sidebar/sessions.tsx:22-108`, rows `active-sessions.ts:53-84`, order 50 `plugin/internal.ts:28` | `session.list` + `session_status` store (`sync.tsx:623-626,944-951`); server `session.status` (`httpapi/session.ts:168-176`) + `GET /global/event` (`sdk.gen.ts:305-310`); agent/model from last user message | PARTIAL | `app/src/pages/layout/sidebar-items.tsx:156-170` (`isWorking` spinner only — no title/agent/model/state/elapsed block, no `none active` row, no 1 s tick). Status IS consumed (`message-timeline.tsx:261`, `session.tsx:799,994,1500-1501`) but never aggregated |
| 2 | Protocol row + living-connection badge `tui/feature-plugins/sidebar/protocol-row.ts:45-101` | facts: `gateway.protocol.selected` bus event (`adaptive-client.ts:958-976`, dir `global`); badge: `globalThis.__gatewayLiveStatus` (`gateway/mod.ts:131-142`, server-process-local, NO bus publish) | PARTIAL | `session/protocol-cell-view.tsx` (global-emitter sub, boundary guard, always-a-value; badge OMITTED — no web-reachable source, needs a server route)
| 3 | Model per agent/scope `tui/component/dialog-agent.tsx:30-…`, `agent-model-cell.ts:50-103`, `local.tsx:forAgent/phaseScope` | worktree `PATCH /config` (`tui/context/local.tsx:895-897`); global `global.config.update` (`local.tsx:658,701,823,883,1037`); session file; scope via `phaseScope()` (`local.tsx:773-782`) | PARTIAL | `session/model-cell-view.tsx` (read); WRITES: session via `useLocal`, global via `global.config.update` (TUI merge shape) — both in `dialog-select-model.tsx`; worktree per-agent selection needs a model-state server route |
| 4 | Agent/model dialog + scope picker `dialog-agent.tsx:558-592` (`AgentScopeDialog`), `dialog-model.tsx:39-60`, KV `SCOPE_KV_KEY` | SAME as #3 (a layer written behind the TUI's back gets overwritten — measured on `model.json`) | PARTIAL | dialog `dialog-select-model.tsx` HAS session/global picker (persisted) + global write via `global.config.update` (TUI shape); popover still session-only (follow-up); worktree needs a model-state server route |
| 5 | Todo (plan state) block `tui/feature-plugins/sidebar/todo.tsx:7-30` (order 400), rows `component/todo-item.tsx` | `api.state.session.todo()` ← server `session.todo` (`httpapi/session.ts:197-206`) | PRESENT (verify wiring in W3) | `composer/session-todo-dock.tsx` (progress `:57-71`, list `:200-227`)
| 6 | VCS indicator `tui/util/vcs-indicator.ts:42-47` (`jj→fossil→git`, colors `:49-60`), `sidebar/footer.tsx:20-32` | TUI: local fs checks; `GET /vcs` exists but carries no backend detection | PARTIAL | `layout/vcs-cell-view.tsx` (project.vcs + sync.data.vcs.branch, unknown-fallbacks); fossil-sidecar half needs a server route (residual)
| 7 | Graph-prep progress: prompt status line `tui/component/prompt/index.tsx:1561-1564` shows busy `message` (`d2b0078624`, plan `2026-10-15_prompt-noop-http`) | `session.status` busy `message?: string` (`session/status.ts:19-23`) ← `graph-prebuild.ts`; same `session_status` store/event as row 1 | PARTIAL | `session.tsx:799` reads `session_status[id]?.type` only — `message` never rendered
| 8 | Session view: messages + tool parts + summaries/compaction `tui/routes/session/index.tsx:232,…:1994-2136` (compaction panel), `:288-343` (memory collapse), `dialog-timeline.tsx` | `sync.data.message/part`, `session.messages/revert` routes, question/permission events | PARTIAL | `session.tsx` + `message-timeline.tsx` (+ `composer/session-{permission,question,revert,todo,followup}-dock.tsx`) PRESENT; compaction/L1-summary panel MISSING (no `compaction` hit in `app/src`); tool `task` part handled (`message-timeline.tsx:74`) |
| 9 | Prompt area `tui/component/prompt/index.tsx` | composer state → `session.prompt` routes | PRESENT (verify in W4) | `components/prompt-input.tsx` + `session-composer-state.ts` (has `session-composer-state.test.ts` pattern) + `build-request-parts.test.ts`, `submit.test.ts` |
| 10 | Settings dialog `tui/component/dialog-settings.tsx:53-…` (global/worktree, `settings/registry.ts`) | `GET/PATCH /config` (`httpapi/config.ts:23-41`) + `global.config.get/update` (`httpapi/global.ts:53-69`) | PARTIAL | `components/dialog-settings.tsx:12` + `settings-general/keybinds/models/providers.tsx` — scope parity unverified (W4) |

Invariant for every status built here (AGENTS.md): a value or `unknown`, never blank.

## Build order (owner priority)

1. W2 — Active Sessions web block (title, agent/model+variant, state, elapsed; explicit `none active` when idle),
   same `session_status` source as row 1. If t52's TUI block never lands, that is the t52 owner's lane — this task
   does NOT take it over (disjoint paths).
2. W3 — sidebar status rows (protocol, model per agent/scope, plan state once W0 pins it, VCS tri-state).
3. W4 — agent/model dialog with scopes, writing through the SAME server path the TUI uses (#3 sources).
4. Rest by the table.

## Surfaces (G6 binding)

| box | path | what |
|---|---|---|
| W0 | grounding only | pin TUI plan-state row + graph-prep progress sources (row 5, 7 → PRESENT/PARTIAL/MISSING with file:line) |
| W1 | this plan file | parity table above (Deliverable 1) |
| W2 | `packages/app/src/pages/layout/active-sessions.*` (new) + wiring in `sidebar-workspace.tsx` or `layout.tsx` | web Active Sessions block: same `session_status` map, `busySince` in-memory map, 1 s tick for elapsed only, `unknown` fallback, `none active` invariant; web test pattern per existing `*.test.ts(x)` beside it |
| W3 | `packages/app/src/**` (status rows) | protocol/model/plan/VCS rows per table, value-or-`unknown` |
| W4 | `packages/app/src/**` (dialogs) | scope picker + SAME write path as TUI (#3 sources); regression: TUI-overwrite probe (write via web, read back through TUI path) |
| W5 | typecheck + visual oracle + `_build.ps1` + commit per closed gap naming the plan, staged by path | proof |

<!-- sv: Keywords: web-active-sessions-block 0.4, same-status-source 0.3, parity-table 0.3; dominant: web Active Sessions block on the same session.status source with tests first; md5: a41d8e2f70b3a5962d1c4e0f8a6b5941 -->
- [x] W0 GROUND missing sources: TUI plan-state row + graph-prep progress pinned to file:line, table rows 5+7 updated
<!-- sv: Keywords: missing-sources 0.5, plan-state 0.25, graph-progress 0.25; dominant: pin the two TUI sources the table could not; md5: b52e9f3071c4b6073d2d5f189b7c6052 -->
- [x] W1 PLAN: this file with parity table = Deliverable 1 (all 10 rows carry file:line both sides)
<!-- sv: Keywords: parity-table 0.6, measured-sources 0.4; dominant: the measured table itself is the deliverable; md5: c63fa03082d5c7184e3e60190c8d7163 -->
- [x] W2 RED then GREEN: web Active Sessions block shows busy/retry sessions with title/agent/model/state/elapsed and `none active` when idle, from the same `session_status` source (RED 20261015T135202Z_64a23729 exit 1 missing module; GREEN 20261015T135251Z_2f836972 8/8; typecheck 20261015T135544Z_8b08cb04 exit 0; parity 20261015T135626Z_d5197a41; layout 20261015T135640Z_8cff4095)
<!-- sv: Keywords: web-active-sessions-block 0.4, same-status-source 0.3, parity-table 0.3; dominant: web Active Sessions block on the same session.status source with tests first; md5: a41d8e2f70b3a5962d1c4e0f8a6b5941 -->
- [x] W3 sidebar status rows in web (protocol DONE; model-cell + vcs-cell DONE: helpers+tests GREEN, both mounted — ModelCell in session header, VcsCell in sidebar panel; typecheck exit 0; badge + fossil-sidecar need server routes — residuals with pins)
<!-- sv: Keywords: sidebar-status-rows 0.5, value-or-unknown 0.5; dominant: every web status shows a value or unknown, never blank; md5: d74ab14193e6d8295f4f71201d9e8274 -->
- [x] W4 agent/model dialog with scopes (slice: session + global; worktree per-agent selection needs a model-state server route — TUI writes model.json by fs, never faked here)
<!-- sv: Keywords: scoped-dialog 0.5, same-write-path 0.5; dominant: web writes go through the TUI's own routes; md5: e85bc25204f7d930606082123e0af9385 -->
- [ ] W5 proof (idle DOM+probe banked; busy frame BLOCKED keyless: 4 models × 5 turns → 401 Invalid credential, isRetryable:false — the 10-07 public-key path regressed upstream; STAND: .temp/t59-stand/opencode.exe @ 10.0.1374 (with W4, build 20261016T044744Z_411d4819 exit 0 smoke 10.0.1374), dist/bin free, no oracle server running)
- **t135 (2026-10-22): W5 is class (c) — an external credential wall, quoted from this box:** «busy frame BLOCKED keyless: 4 models × 5 turns → 401 Invalid credential, isRetryable:false — the 10-07 public-key path regressed upstream». The idle DOM + probe half is already banked; only the BUSY frame needs a working credential, and a credential is the owner's to supply. Resume: the owner supplies a key for ONE model → one busy turn → the frame capture on the stand (`.temp/t59-stand/opencode.exe @ 10.0.1374`, build `20261016T044744Z_411d4819`). No SUCCESS is claimed over the idle half.
<!-- sv: Keywords: visual-oracle 0.4, build-receipt 0.3, commit-by-path 0.3; dominant: each closed gap carries a receipt; md5: f96cd36315f8e041717193234f1be0496 -->

## Smoke Tests

- Web tests first per component where the web app has a test pattern (measured: `packages/app/src/**/*.test.ts(x)` —
  e.g. `pages/session/session-model-helpers.test.ts`, `context/model-variant.test.ts`, `context/global-sync/*.test.ts`).
  Run ONE file per call: `cmd_runner start --cwd packages/opencode -- bun test <file>` (or the app package runner
  the repo uses for `packages/app` — verify before first run); read `<run>/state.json` + whole output.
- Typecheck per repo convention before any commit.
- Visual oracle (per closed gap): build ONCE (`pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root,
  read its `state.json`), start a server from `dist\bin` under cmd_runner in a child env with every
  `*_API_KEY/*_TOKEN/*_SECRET` removed (names only in the record), open the web form in a browser, capture each
  closed gap. Hosts we work with stay in `bin` (owner: «dist/bin только для обкатки, хосты поднимаем из bin»).
- Expected deltas: RED→GREEN on the new web test; idle web frame shows `none active`, busy frame lists the session
  (title/state/elapsed visible) — same contract as t52 S6.
