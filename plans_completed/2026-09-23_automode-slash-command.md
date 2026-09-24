<!-- intention: no bounded auto-continuation for the active session -> /automode [N] toggles a live [AUTO] indicator that auto-continues on idle and exits only when the plans are complete (or after N iterations) -->

# /automode — bounded auto-continuation for the active session

**Status:** CLOSED (2026-09-24, moved to `plans_completed/`) — T1–T4 done; T3's live remainder (exit paths) is owner-confirmed, the machine record of that live run is not located.

Owner, 2026-09-23: «добавь опцию /automode чтобы всплывала метка авто из которой агент может выйти только
завершив план если ничего не указано или чисто циклов итераций ... /automode [iterations]?»

## 0. Prior art (REUSE.BEFORE)

- **AGI mode already implements the autonomous loop** over `sync.data.session_status` (`busy` /
  `compacting` / `idle`), plan hygiene via `util/plan-status.ts`, and prompt dispatch via
  `sdk.client.session.promptAsync` ✓ (`context/agi-mode.tsx:290-306` status readers, `:353-373`
  `sendToWorker`). `/automode` is the SINGLE-SESSION, no-orchestrator subset of that machinery: reuse
  `planDebt`, `promptAsync`, and the busy→idle transition — do not re-invent them, and do not start
  worker sessions.
- **Slash commands**: `CommandOption.slash = { name, aliases? }` ✓ (`component/dialog-command.tsx:21-24`);
  `useCommandDialog().slashes()` maps them to `{ display, description, aliases, onSelect }` ✓ (`:88-99`);
  the prompt dispatches TUI slashes BEFORE server commands ✓ (`component/prompt/index.tsx:844-857`).
  The prompt already parses the first line into `cmdName` + `args` ✓ (`:845-850`) but does NOT pass
  `args` to TUI slashes — T1 extends exactly that seam.
- **Indicator precedent**: `[AGI ●] progress` / `[AGI ○] disabled` ✓ (`routes/session/index.tsx:1778-1785`),
  and `agi.toggle` registered as a command with a hint ✓ (`app.tsx:646-657`, `component/command-hints.ts:54`).
- **Exit criterion already exists**: `planDebt(worktree).open === 0` is the «no open boxes anywhere»
  count ✓ (`util/plan-status.ts:403-412`). «Агент может выйти только завершив план» maps to it.

## 1. Tasks

- [x] **T1 — slash argument path (SUBSTITUTED, done).** TUI slashes take no arguments by
  construction (`dialog-command.tsx:88-99` builds `onSelect: () => trigger(value)`), so instead of
  widening that machinery the prompt's slash branch — which ALREADY parses `cmdName` + `args` —
  intercepts `cmdName === "automode"` and hands the raw `args` to `automode.handleSlash`
  (`prompt/index.tsx:858-861`). The command is still registered in the palette with
  `slash: { name: "automode" }` for autocomplete (`app.tsx:647-657`).
  Oracle: `bun typecheck` exit 0 (run `20260923T043802Z_d23b1a29`) + the parser pins (T2).
- [x] **T2 — pure logic + context (DONE; exit criteria v2 = the plan MOVE, not «no open boxes»).**
  `context/automode-logic.ts` (pure): `parseAutoModeArgs(raw)` → `""` = `{kind:"current"}`,
  `"all"` = `{kind:"all"}`, `"N"` = `{kind:"iterations", limit:N}`, `"0"`/words → `{error}`;
  `autoModeDecision({kind, iteration, limit, plansAtStart, plansNow})` → for `current`: STOP when
  `plansNow < plansAtStart` (a plan LEFT `plans/`); for `all`: STOP when `plansNow === 0`; for
  `iterations`: STOP on the counter alone. The plan state is read with `getPlanStatus(worktree).active`
  — the SAME placement tooling the orchestrator uses for hanging plans, per the owner's «чекап … точно
  такой же как тулза проверки висячих проектов».
  `context/automode.tsx`: ONE service for the TUI (module-level signals + a watcher over the active
  session's `sync.data.session_status`); `idle → decision → promptAsync("continue") → wait busy → wait
  idle → decision`; `error`, the 24 h cap and a failed continue stop the mode. It is an OVERLAY on
  build_mode — the same identity and rules plus the continuation loop; not a separate mode and not
  an AGI submode (owner, 2026-09-23); AGI is untouched.
  Oracle, RUN: `bun test test/tui/automode.test.ts` = **8 pass / 0 fail** (15 expect, run
  `20260923T043752Z_e3189cb2`) + `bun typecheck` exit 0 (run `20260923T043802Z_d23b1a29`). The pins fail
  on the old rules by construction (a reached limit still returning `continue`; `plansNow` unchanged
  still stopping under `all`).
- [x] **T3 — command, indicator, hint (editors done; smoke observed; live-exit remainder owner-confirmed below).** `automode.toggle`
  registered with `slash: { name: "automode" }` next to AGI (`app.tsx:647-657`); the label
  `[AUTO ● plan | all | k/N]` renders next to `[AGI ○]` (`routes/session/index.tsx:1789-1798`); the
  `COMMAND_HINTS` entry added. Rebuild done (`dist/bin/opencode.exe`, 2026-09-23 13:23:47 local).
  OBSERVED: the owner enabled the mode inside his own TUI (owner, 2026-09-23: «Ну что-же режим
  включен») and the FIRST auto-continue arrived in the live session as a real `continue` turn — the
  cycle works end-to-end. NOT observed then: the exit paths (iteration limit / plan moved) on a live
  session — the table is pinned in unit tests (automode.test.ts, 8 pass / 0 fail, run
  `20260923T043752Z_e3189cb2`) — later owner-confirmed: live testing on 2026-09-24 (shelf readme),
  the machine record of that live run not located; and an automated
  ConPTY smoke of our own: the TUI came up on the new build and accepted input, but the stripped
  ConPTY log returns fragmentary frames — it is NOT a render oracle (class: a TUI's alt-screen diff
  cannot be read back from `stdout_text.log`; the test session was stopped cleanly). Still open by
  design: the continuation text is just «continue» — its productivity is judged on the first long
  run, not assumed.

- [x] **T4 — agi_workout journal + host-local kernel binding (DONE).** The folder `agi_workout/` now
  carries its canon (README: what goes in — new-tool decisions and the overlay's blockers; format —
  `[ISO8601]_<slug>.md` with kind/status/why/evidence/oracle/next). Bound in THIS kernel's addons
  only: `prompt_kernel/addons.py` G1 `PATH_AGI_WORKOUT` (read before inventing a tool) + G7
  `PATH_AGI_WORKOUT_LOG` (write while the overlay runs); declared as product-only differences in
  `tests/test_variant_parity.py` — the Codex/Claude registries stay untouched, per the owner
  («специфично только для нашего кернела, не для codex или claude»). Budget: the pair moved
  `utf8_budget` 46_000 → 47_000 in `source.py` (measured 46_311 B, the smallest thousand above the
  measurement).
  Oracle, RUN: `python -m prompt_kernel --install` → `installed=87ece3ba7361de94206a110df107e5f3b33667d74898bfd8747430acffe80b7a`,
  `utf8_bytes=46311`; baseline pinned in `prompt_kernel/baseline.json`; final
  `python -m pytest prompt_kernel/tests/ -q` = **106 passed** (1.10 s). NOT done: the binary rebuild
  — the installed prompt reaches a NEW session only after the rebuild (T3's smoke covers both).

## 2. Smoke Tests (PRE_FLIGHT — before any edit)

Baseline [Exact], from `packages/opencode`:

1. `bun test test/tui/` — record counts (last known: 140 pass / 0 fail; the 158/140 drift is an open
   finding, record what the run actually gives).
2. `bun typecheck` — exit 0.

Baseline RECORDED 2026-09-23: `bun test test/tui/` = **153 pass / 0 fail** (767 expect, 20 files, run
`20260923T043348Z_f16ada43`); `bun typecheck` = exit 0 (run `20260923T043348Z_6a47b54e`).

Post-implementation: the same two, plus `test/tui/automode.test.ts`, plus the manual smoke of T3.

## 3. Risks and rollback

- **Runaway loop** — «unlimited» means the mode ends only when the plans close. Containment: manual
  `/automode` toggle-off, session `error` stops, runtime cap 24 h, and ever-increasing `iteration` is
  visible in the label. Rollback: `toggle` off is one command; the feature is additive.
- **Double dispatch** — a decision taken twice for one idle transition would send two `continue`s.
  Containment: the phase machine advances to `wait-busy` BEFORE the async send resolves, and the send
  failure path stops the mode with a toast (never a silent retry).
- **Wrong session** — only the ACTIVE sessionID receives `continue`; a `promptAsync` error stops the
  mode rather than retrying.
- Rollback: each task is one commit; T2/T3 are new files plus two call sites, so removing the
  registration reverts the feature without touching AGI mode.
