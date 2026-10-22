<!-- intention: TUI sidebar has no live view of running sessions (owner must open the sessions dialog to guess what is running) -> a sidebar block lists every busy/retrying session of THIS server (API robots included), refreshed ~1 s, with an explicit «none active» when idle -->
<!-- goal_sv:
Keywords: sidebar-active-sessions 0.35, event-synced-store 0.25, elapsed-tick 0.20, none-active-invariant 0.20
Semantic dominant: The owner sees at a glance which sessions of this server are running — robots included — read from the store the TUI already event-syncs, with the 1 s tick spent only on elapsed time and an explicit «none active» when idle.
md5: b7e2c41d90a85f3671d4c0e2f8a6b593
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->
<!-- subgoal: s3-surfaces-agent-sees-drives — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S3 -->

# t52 — TUI sidebar: live list of active sessions on the server

Owner, 2026-10-15: «чтобы случайно не прибить крутящуюся сессию… добавь в панель tui список активных задач, и чтобы он
через скажем 1 секунду обновлялся… Вывод списка sessions это показывает, но как бы не удобно».

## Data path — REUSED store, no poll (decided at G1, receipts)

- `session_status` is already event-synced: `packages/opencode/src/cli/cmd/tui/context/sync.tsx:623-626`
  (`case "session.status"` → `setStore("session_status", …)`), bootstrapped once at `:964-966`
  (`sdk.client.session.status({ workspace })` → `reconcile`). Server side the map holds only non-idle entries
  (`packages/opencode/src/session/status.ts:77-86` deletes on idle) but the TUI store may hold an `idle` row — the
  block filters on `type !== "idle"`.
- Full session list (title, id): `sync.data.session` (`sync.tsx:74`, filled from `session.list` at `:944-951`).
- Plugin read surface: `api.state.session.list()` / `api.state.session.status(id)` /
  `api.state.session.messages(id)` — `packages/opencode/src/cli/cmd/tui/plugin/api.tsx:153-181`; types
  `packages/plugin/src/tui.ts:264-289`.
- Agent+model per session: last user message carries `agent` + `model.{providerID,modelID}`
  (`packages/sdk/js/src/v2/gen/types.gen.ts:602-626`); message events for ANY session land in the store
  (`sync.tsx:628-651`), so robot sessions expose their model too; before the first event → `unknown`.
- **No new poll, no new JSON file** (AGENTS.md § Storage Paradigm). The 1 s tick only re-renders elapsed time —
  same wall-clock cadence the sidebar already uses for cache stats (`feature-plugins/sidebar/context.tsx:30,269-277`).
- API robots (`robot-wave:*`, created via `POST /session` + `prompt_async` —
  `experiments_history/2026-10-08_robot-wave/dispatch.py:39-51`) are ordinary sessions of this server: they appear
  through the same two stores. No special casing.

## Surfaces (G6 binding)

| box | file | what |
|---|---|---|
| S2 | `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/active-sessions.ts` | pure rows: state map, busySince stamp/clear, elapsed, longest-first sort |
| S3 | `packages/opencode/test/tui/sidebar-active-sessions.test.ts` | unit + `testRender` block oracle (RED first) |
| S4 | `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/sessions.tsx` + `plugin/internal.ts` | View (pure-api like `jobs.tsx`, no contexts) + registration, slot `sidebar_content`, order 50 (above context@100 so it is seen first) |
| S5 | typecheck | `bun typecheck` from `packages/opencode` |
| S6 | visual oracle | `_build.ps1` once → `dist\bin\opencode.exe` under cmd_runner, keys stripped → busy frame lists the session → idle frame shows «none active» |
| S7 | commit + `_progress_log.md` | one commit naming the plan, staged by path |

Row shape (mirrors `jobs.tsx:52-68`): line 1 = glyph + truncated title + right-aligned elapsed; line 2 (muted) =
agent · model · state · short-id. State labels: `busy→working ⏳`, `retry→retrying ⚠ (+attempt)`,
`compacting→compacting ⟳`, `summarizing→summarizing ⟳`, anything else → `unknown ●` — never blank
(AGENTS.md: absence of an oracle reads as FALSE).

<!-- sv: Keywords: active-session-rows 0.4, state-map 0.3, elapsed 0.3; dominant: pure row computation over the event-synced stores; md5: c41d8e2f70b3a5962d1c4e0f8a6b5937 -->

- [x] S1 RED: `test/tui/sidebar-active-sessions.test.ts` fails before the helper exists (no block / no busy session listed) — receipt `20261016T072629Z_4954de14` exit 1, 0 pass / 7 fail on `.temp/s1-red/` replay (test copy + stub helper with absent behavior): toHaveLength(1)→0, blank labels, stamp never cleared; harness loaded clean, all 7 fail on assertions
- [x] S2 helper GREEN: busy/retry/unknown rows, idle cleared, elapsed ticks with `now`, longest-first sort — receipt `20261016T070710Z_e26a6418` exit 0, 9 pass / 0 fail (7 unit tests)
- [x] S3 render test GREEN: busy fixture frame lists the session; idle fixture frame shows «none active» — same receipt (2 render tests); frames saved `.temp/t52b-frames/busy.txt`, `.temp/t52b-frames/idle.txt` via `20261016T071632Z_97e92492` exit 0
- [x] S4 plugin wired: sessions.tsx + internal.ts registration (order 50) — receipt: `git diff HEAD` shows exactly 2 added lines (import + list entry after SidebarJobs); slot `sidebar_content` order 50 (`sessions.tsx:94`)
- [ ] S5 `bun typecheck` PASS from packages/opencode — OPEN: package red exit 2, 10/10 errors in `src/session/llm.ts` (peer's in-flight `M`, in tree since t52b start; 0 reference t52b paths). Next: re-run after the peer lands llm.ts.
- [x] S6 visual oracle: busy frame lists the session; idle frame shows «none active» (fresh frames, run ids recorded) — receipts above; busy frame shows title/state/elapsed, no «none active»; idle shows «none active», never blank. Method: stub provider in the test harness (task-authorized; keyless cost-0 models 401 per t59, Go-model check inconclusive)
- [x] S7 commit naming the plan; `_progress_log.md` entry appended (both entries kept on conflict) — receipt: this commit via `scripts/commit_own.py`

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tui/sidebar-active-sessions.test.ts` — RED before S2, PASS after; read `<run>/state.json` + whole output.
- `bun typecheck` from `packages/opencode` — zero new errors.
- `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root — read its `state.json`.
- Visual: fresh frame with one busy session lists it (title/state/elapsed visible); fresh idle frame shows «none active». Keys stripped by NAME in the run record.
- Expected deltas: RED→GREEN on S1→S2/S3; idle frame differs from busy frame exactly by the row list.
