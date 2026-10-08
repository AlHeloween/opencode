<!-- intention: the status note's goal/plan line is chosen by something global (the newest plan file on disk) and is the same for every session -> each session's status note names the plan THAT session's own messages bind it to, or states «no plan bound» — never another session's plan -->

# Session status note names the SESSION's own goal

- sv: { keywords: { status-note 0.30, goal-attribution 0.30, per-session-plan 0.25, regression-test 0.15 },
        dominant: "The compaction-status goal line is derived from the session itself, not from the newest plan file." }
- Reported by the owner 2026-10-08 (the hourly check, read in the robot sessions' own turns): EVERY robot
  session's `<compaction-status>` note named `plans/2026-10-08_org-verbs-and-heartbeat.md` (then untracked,
  the newest plan file) as its goal, whatever brief that session had been given.
- Binding (everything else read-only): `src/session/compaction.ts` (the note builder), the caller in
  `src/session/`, one new test under `test/session/`, `_progress_log.md`, this plan.

## Premises (grounded in code, 2026-10-08)

- `prompt.ts:2049` builds the note's plan input as `collectPlanState(worktree)`; `prompt.ts:2053` takes
  `SessionCompaction.owedTasks(debt)[0]`; `prompt.ts:2054-2061` reads that task's manifest. Nothing in the
  chain sees the session.
- `util/plan-status.ts:316-341` — `collectPlanState` is a HEAD surface: relevance filter, sorted by ISO
  prefix **newest first**, `.slice(0, 3)`. `owedTasks` (`compaction.ts:819-823`) returns open boxes in that
  order, so `owed[0]` is «the newest plan file on disk, its first open box» — the same address for every
  session in the worktree.
- `compaction.ts:842-1087` — `tailNote` is pure; its `debt` input supplies BOTH the count and the address,
  and the `svm:` line describes the task the `owed:` line names (the caller reads `owed[0]`'s manifest).
- No per-session plan binding exists anywhere: no session column, no store key (checked: `session.sql.ts`
  has no plan field; `session/svm.ts` is keyed by plan+task only).
- The session DOES carry the evidence: its own messages name the plan it was told to work on (the brief),
  and its own `write`/`edit` calls name the plan files it authored.

## Tasks

- [x] **S1 — `compaction.ts`: the session's own plan and the note's address.** New pure exports next to
  `owedTasks`: `SessionSignal {text, writes}`; `sessionPlan({messages, plans})` — the newest
  `plans/<file>.md` signal in the session's OWN messages that resolves to a plan on disk (writes before
  text within a message; reads are deliberately not signals); `sessionTarget({messages, plans})` — that
  plan plus its first open task, spelled through `owedTasks` so there is one answer to «what is next»;
  `sessionSignals(WithParts[])` — the projection the caller hands over (text parts + `write`/`edit`
  `filePath`). `tailNote` gains `own?: {plan, task} | null`, and its debt block prints the address from
  `own` when present — including the explicit `no plan bound to this session`.
- [x] **S2 — `prompt.ts`: wire the session in.** Replace `collectPlanState(worktree)` + `owedTasks(debt)[0]`
  with one `parsePlanFiles(worktree)` read → `sessionTarget({messages: sessionSignals(msgs), plans})`; the
  `svm` line follows the same target; `debt` is no longer handed in (its only remaining consumer was the
  legacy address, and the count comes from `debtTotal`).
- [x] **S3 — RED test** `test/session/status-note-goal.test.ts`: two sessions with two briefs, two goal
  lines; the unbound session says so and names no plan; newest signal wins; writes count, reads do not;
  a bound plan with clear boxes says so. Run RED on the pre-fix tree, record the run id.
- [x] **S4 — GREEN + oracle:** the new file green, `test/session/tail-note.test.ts` and
  `test/session/compaction.test.ts` green (one file per run), `bun typecheck` from `packages/opencode`.
- [x] **S5 — record + close:** `_progress_log.md` entry, `pwsh -NoProfile -File _build.ps1` through
  cmd_runner, commit the plan's own paths, move this plan to `plans_completed/` in the same commit.

## Smoke Tests

Oracle = the new test file (pure: tmp worktree + the three exported functions; no Instance, no model).
Predictions per case (trader's rule — an off-prediction outcome is a divergence, logged):

| # | case | pre-change prediction | post-change prediction |
|---|------|----------------------|------------------------|
| C1 | session A (brief names alpha) vs session B (brief names beta) -> two different `next:` lines | FAIL (both name the newest plan) | PASS |
| C2 | the note for A names neither beta nor any other session's plan | FAIL | PASS |
| C3 | a session whose messages name no plan -> `no plan bound to this session`, no plan path | FAIL (names the newest plan) | PASS |
| C4 | `sessionTarget` picks the newest signal, and a plan file the session WROTE binds it | FAIL (function absent) | PASS |
| C5 | a bound plan with no open box -> `next: none in <plan> — its boxes are clear` | FAIL | PASS |
| C6 | `sessionSignals`: `write`/`edit` filePaths are signals, a `read` filePath is not | FAIL (function absent) | PASS |
| C7 | control — the legacy contract is untouched: `tailNote` with no `own` still prints `owed[0]` of `debt`, and `tailNote({open:[],window:null})` is still `""` | PASS | PASS |

## Risks

- R1: the caller's own composition (4 lines of glue in `prompt.ts`) is not driven by the test — the test
  drives `sessionSignals` + `sessionTarget` + `tailNote`, the three functions that glue composes. Named,
  not hidden: a regression must be visible in the glue by reading it.
- R2: a session that merely QUOTES another session's plan path in prose can be attributed to it (newest
  signal wins). Bounded by the rule that only plans on disk resolve, and by writes outranking quotes
  within a message; a session that never names or writes a plan is reported as unbound, which is honest.
- R3: `own` is ignored by any caller that does not pass it — the legacy path stays for callers with no
  session context (`tail-note.test.ts`, `vector-coupling.test.ts`), so those files must stay green.

## Out of scope

- Making the note's COUNT per session: `owed: N open plan task(s) in M plan(s)` is `@LOOP_MEASURE`'s
  project-wide measure and stays global (§ owner 2026-09-22: the measure is the total, the address is
  where to start).
- A durable per-session plan BINDING (a session column or store key). The session's own messages are
  already the evidence; a second home would need keeping in step (AGENTS.md § Storage Paradigm).
- The KV-cached system prefix: untouched — the note is the mutable tail.

## Evidence (run ids, 2026-10-08)

- RED (pre-fix tree, new test): `20261008T062145Z_669fe8bc` - exit 1, **1 pass / 9 fail** (10 cases), log
  11 192 B, dropped 0, truncated false. The behavioural reds ARE the reported defect: the session bound to
  `plans/2026-10-01_alpha.md` was handed `next: plans/2026-10-08_beta.md B1 [PENDING]` (the newest file), the
  unbound session was handed a plan anyway, and a bound plan with clear boxes was filled in with another's
  task - plus 5 `TypeError: Compaction.sessionTarget/sessionSignals is not a function` reds (the capability
  absent), and the control C7 passing on both trees, as predicted.
- GREEN (post-fix): new file `20261008T062232Z_40b4cc64` - exit 0, **10 pass / 0 fail**, 30 expects;
  `test/session/tail-note.test.ts` `20261008T062240Z_65290f61` - exit 0, **13 pass / 0 fail**;
  `test/session/compaction.test.ts` `20261008T062248Z_fed4b2a1` - exit 0, **91 pass / 0 fail**;
  integration guard `test/session/vector-coupling.test.ts` `20261008T062345Z_03b72234` - exit 0, **14 pass**;
  `bun typecheck` (packages/opencode) `20261008T062322Z_cdd7c436` - exit 0, log 280 B, truncated false.
- Predictions vs outcomes: every case landed on its prediction (C1-C6 FAIL→PASS, C7 PASS→PASS). No divergence
  to log.
- Docs: `docs/compaction.md` § fold-readiness (item 4) and § "The pushed status note" now state that the
  ADDRESS is the session's own plan, and name the old behaviour for the record.
