# Stop claim — one form for every exit, made BINDING by mechanism (t36 lane, owner «Да + механизм»)

<!-- intention: a plan parked in plans/postponed/ or declaring BLOCKED/WAITING, and a primary-agent turn that ends declaring a blocked/stopped outcome, can close with an empty routes list -> both surfaces DEMAND the «## Stop claim» form (routes table route|receipt|failing component, untried routes, reopen_when): planstatus reports a missing or empty claim as a violation, and the end-of-turn stop-check continues such a turn ONCE -->

<!-- goal_sv: stop-claim, routes-table, planstatus-violation, blocked-turn-continuation, reopen-when -->

- **plan_id:** 2026-10-14_stop-claim-form
- **revision:** 1
- **state:** DRAFT
- **reported:** owner, 2026-10-14: «Да + механизм» — the kernel gets ONE stop-claim form for every exit (t42 report §1.5, §2, §2.2), and a **mechanism** must make the form binding, because kernel text binds nothing at runtime (`experiments/2026-10-13_kernel-exit-audit/PREDICATES.md`). The case to make impossible: Codex parked a plan as BLOCKED after ONE refused route — reason = the refusal text, lift signal = a tautology, no routes list (`docs/robot-protocol-log.md:49`).
- **why it matters:** the measured Codex shape is «k2 again — a route's stop accepted as the task's stop». The t42 report's own wiring table (`REPORT.md:342-360`, rows E2/E5/E7, TOOLCHAIN, PATH_CLOSURE) shows every BLOCKED-family exit demanding today only a sentence; the fix is wiring, not vocabulary.

```yaml
Keywords: stop-claim 0.32, routes-table 0.24, planstatus-violation 0.18, blocked-turn-continuation 0.16, reopen-when 0.10
Semantic dominant: Make the «## Stop claim» form binding on both surfaces — planstatus reports parked/blocked plans without a valid claim, and the end-of-turn stop-check continues a turn that declares blocked without one.
md5: 3a7e5c1f9b2d8046a1c93e57d0b46f82
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (each line carries its instrument)

- ✓ **The form** — `experiments/2026-10-14_kernel-reanalysis/REPORT.md:136-137`: `STOP_CLAIM := { statement, scope, receipts[], falsifier, reopen_when }`; §2 row E7 (`:350`): «the BLOCKED claim: no route reaches — routes tried with receipts, failing component each, untried named»; §2.2 (`:381-397`): the refusal shape, whose «resume condition» IS the postponed template's «lift signal» (`:511`).
- ✓ **Why a mechanism, not text** — `experiments/2026-10-13_kernel-exit-audit/PREDICATES.md:8-24`: the FSM predicates are build-time IR; `is_valid_transition` has **17 callers, all in `prompt_kernel/tests/`**; the installed variants carry 0 matches for `EVALUATE_STOP|EMIT_CLOSURE|FSM|blocked_by_human` (positive control `BOUNDED STOP (DONE) iff` → 1). «The exit's form must live in the shipped TEXT (a slot), or in a harness check.»
- ✓ **The measured case** — `docs/robot-protocol-log.md:49`: Codex, plan `2026-10-14_independent-glm-cache-probe`, commit `a45cfd8f30`: two launches of ONE route refused «blocked by policy»; recorded as BLOCKED with the refusal text as reason and «runtime permits the launch» as lift signal; no component split, plan parked in `postponed/`. That file NOW lives in `plans_completed/` (moved by its own session 2026-10-14 17:43); the standing unfixed set is the **8 plans under `plans/postponed/`** (none carries a stop claim).
- ✓ **The blind spot in the audit surface** — `packages/opencode/src/util/plan-status.ts:601-603`: `getPlanStatus` reads ONLY `plans/` + `plans_completed/`; `plans/postponed/` is never read, so a parked plan is never audited. Violation-line pattern to mirror: `No checklist` (`:819-827`), `STALE STATED` (`:835-839`), `MASTER PLAN GAPS` (`:843-847`); alert form `PLACEMENT DEBT` (`:870-874`). `collectPlans` (`:420-432`) is the flat reader; `parseLifecycle` (`:198-222`) already reads `state:`/`Status:`.
- ✓ **The lane that carries part (2)** — `src/session/stop-check.ts` + the loop-head hook in `src/session/prompt.ts` (commits `13f125a543`/`837d8d8184`, closed plan `plans_completed/2026-10-13_robot-host-stop-check.md`): decision order question → handoff; latch `metadata.stop_check`; switch `OPENCODE_STOP_CHECK=0|false|off|no`; verified by the switch-off differential `20261013T152430Z_d1c50ec0`.
- ✓ **Harness facts** — `test/util/plan-status.test.ts:112-204` builds worktree fixtures (`plans/` + `plans_completed/`); the tool test asserts only substrings (`test/tool/plan-status.test.ts:52-55`), so a NEW report line cannot silently break it.

## Acceptance frame (named BEFORE the work)

| # | Criterion | Instrument | Falsifier |
|---|---|---|---|
| A1 | A plan under `plans/postponed/` without a valid `## Stop claim` is reported (a field + a report line); one WITH a valid claim is not | `test/util/plan-status.test.ts` (new cases) | the violation is silent, or fires on the valid claim |
| A2 | A plan under `plans/` stating BLOCKED/WAITING/POSTPONED is reported; its ACTIVE sibling is not | same | either half wrong |
| A3 | The form itself: `## Stop claim` + routes table (`route`/`receipt`/`failing component`, ≥1 row, every row complete) + «untried routes» + `reopen_when`; each missing/empty piece is a NAMED problem | `test/util/stop-claim.test.ts` | a broken form reads valid or a valid one reads broken |
| A4 | A primary-agent turn whose last paragraph declares blocked/stopped and carries NO valid claim continues ONCE (hits=2); with a valid claim it ends normally (hits=1) | `test/session/stop-check.test.ts` + one loop case in `test/session/prompt.test.ts` | no continuation, >1 continuation, or a claim-carrying turn blocked |
| A5 | Live repo: `planstatus` names the parked plans as violations; the completed Codex plan is NOT flagged | the `planstatus` tool from the repo root | silence (0 reported), or the completed plan flagged |

## Tasks

- [x] **T1 — form tests first.** `test/util/stop-claim.test.ts`: valid section (control); missing section; table missing a column; zero rows; a row with an empty receipt; `untried routes` missing/empty; `reopen_when` missing/empty; both heading and inline spellings accepted; «lift signal» accepted as the resume-condition carrier. RED before any module exists. ✓ 2026-10-14 — RED `20261014T102823Z_c49c5313` (exit 1, 0 pass/1 fail: module missing); GREEN `20261014T103032Z_360057d5` (12/0, exit 0).
- [x] **T2 — the module (one home).** `src/util/stop-claim.ts`: `findStopClaimSection(text)`, `stopClaimProblems(section)`, `hasValidStopClaim(text)`. No imports — a leaf, so both consumers (plan-status, stop-check) can use it without a cycle. ✓ 2026-10-14 — the leaf is written; the problems are NAMED (`routes table missing` / `row N: receipt empty` / `untried routes missing or empty` / `reopen_when missing or empty`); a bare «none» as untried routes is empty (the Codex tautology), and dashes/n/a are not receipts.
- [x] **T3 — planstatus violation.** `plan-status.ts`: scan `plans/postponed/*.md` and plans under `plans/` whose stated lifecycle is BLOCKED/WAITING(_APPROVAL)/POSTPONED; add `stopClaims: { file, problems }[]` to `PlanStatus`; print `STOP CLAIM: N plan(s) …` when non-zero (the `STALE STATED` pattern). Counts (active/debt/total) stay untouched — this is an audit, not a terminal. Tests (RED first) in `test/util/plan-status.test.ts`. ✓ 2026-10-14 — RED `20261014T102925Z_127bea6d` (4 new fail / 25 pass), GREEN `20261014T103209Z_ae76b71c` (29/0); the live probe `20261014T103704Z_bd08cb7b` reports `STOP CLAIM: 8 plan(s)` naming all 8 parked plans — A5.
- [x] **T4 — the stop-check's third detector.** `src/session/stop-check.ts`: `declaredStopped(text)` = the LAST paragraph (SV block stripped, fences/quoted spans dropped) declares BLOCKED/«заблокировано»/postponed/«не могу продолжить»/«невозможно продолжить»; fires `{ kind: "stop-claim", reason: STOP_CLAIM_REASON }` when `!hasValidStopClaim(text)` — appended AFTER question/handoff so existing decisions are untouched. Tests: new decision cases + one loop case (reply 1 declares blocked without a claim → continuation; the claim-carrying reply ends the turn). ✓ 2026-10-14 — RED `20261014T102938Z_cbad503f` (2 fail) and `20261014T102947Z_e406e96d` (loop case: hits 1, not 2); GREEN `20261014T103137Z_ddbe3044` (28/0) and `20261014T103221Z_fd01dd7c` (loop case 1/0).
- [x] **T5 — verification.** `bun typecheck` exit 0; whole `test/util/plan-status.test.ts`, `test/util/stop-claim.test.ts`, `test/session/stop-check.test.ts`, `test/session/prompt.test.ts` green; the live `planstatus` run shows A5. ✓ 2026-10-14 — the full loop file `20261014T103238Z_182adb4e` 48 pass / 13 skip / 0 fail (baseline 47/13/0 + the new case); the tool-level `test/tool/plan-status.test.ts` `20261014T103737Z_b6b5cfab` 2/0; typecheck first FAILED on a type consumer (`agi-mode.tsx:184` default `PlanStatus` literal) — fixed in the same change — then exit 0 `20261014T103756Z_3bda00b8`.
- [x] **T6 — records.** `docs/architecture.md` (extend §8d) and/or `docs/plan-maintenance.md`; `agi_workout/` entry; `_progress_log.md` entry; `svm render`; one commit naming this plan; `_build.ps1` through `cmd_runner` with `state.json` read. ✓ 2026-10-14 — `docs/architecture.md` §8d extension + two Key Files rows (`util/stop-claim.ts`, plan-status purpose); `agi_workout/2026-10-14_stop-claim-form.md`; `_progress_log.md` entry; `svm render` names this plan in `plans/MASTER_PLAN.md`; commit names this plan (hash in the session report); `_build.ps1` run with `state.json` read.

## Smoke Tests

| # | Instrument | Prediction BEFORE the run |
|---|---|---|
| S1 | `bun test test/util/stop-claim.test.ts` on the UNCHANGED tree | FAIL — the module does not exist (the red of "tests first") |
| S2 | `bun test test/util/plan-status.test.ts` with the new cases, unchanged tree | FAIL — `status.stopClaims` is undefined / no report line |
| S3 | `bun test test/session/stop-check.test.ts` (new cases) and `bun test test/session/prompt.test.ts -t stop-claim`, unchanged tree | FAIL — no `stop-claim` kind; the blocked reply ends with hits=1 instead of 2 |
| S4 | the four files after T2-T4 | PASS; `prompt.test.ts` full file = baseline (47 pass / 13 skip) + 1 new case = 48/13/0 |
| S5 | `bun typecheck` from `packages/opencode` | exit 0 |
| S6 | `planstatus` tool from the repo root | the `STOP CLAIM:` line appears and names the parked plans (re-measure; do not trust the count in this table) |
| S7 | `pwsh -NoProfile -File _build.ps1` through `cmd_runner`, `state.json` read | exit 0; artifacts in `dist/`; `bin/` untouched |

A full `bun test` is forbidden (AGENTS) — always a named file, one file per cmd_runner call.

### Smoke results (actual, 2026-10-14)

| # | Run | Result |
|---|---|---|
| S1 | `20261014T102823Z_c49c5313` | exit 1 — 0 pass / 1 fail, `Cannot find module '../../src/util/stop-claim'` (the required RED) |
| S2 | `20261014T102925Z_127bea6d` | 25 pass / 4 fail — exactly the four new plan-status cases (`status.stopClaims` undefined) |
| S3a stop-check | `20261014T102938Z_cbad503f` | exit 1 — 26 pass / 2 fail (`"stop-claim"` not a kind yet) |
| S3b loop case | `20261014T102947Z_e406e96d` | exit 1 — 1 fail: `llm.hits` length 1, not 2 (no continuation) |
| S4a form after T2 | `20261014T103032Z_360057d5` | exit 0 — 12 pass / 0 fail |
| S4b stop-check after T4 | `20261014T103137Z_ddbe3044` | exit 0 — 28 pass / 0 fail |
| S4c plan-status after T3 | `20261014T103209Z_ae76b71c` | exit 0 — 29 pass / 0 fail |
| S4d loop case after T4 | `20261014T103221Z_fd01dd7c` | exit 0 — 1 pass / 0 fail (hits=2, the latch carries `stop-claim`) |
| S4e whole loop file | `20261014T103238Z_182adb4e` | exit 0 — **48 pass / 13 skip / 0 fail** [257 s] (baseline 47/13/0 + the new case) |
| S4f tool-level file | `20261014T103737Z_b6b5cfab` | exit 0 — 2 pass / 0 fail |
| S5 typecheck | `20261014T103716Z_3fc95cda` → `20261014T103756Z_3bda00b8` | FIRST exit 2 — `agi-mode.tsx:184` default `PlanStatus` literal missing `stopClaims` (a type consumer no grep named); fixed in the same change; then exit 0 |
| S6 live planstatus (current source, live repo) | `20261014T103704Z_bd08cb7b` | exit 0 — `STOP CLAIM: 8 plan(s)` naming all 8 plans under `plans/postponed/` with their named problems; no plan under `plans_completed/` flagged — A5 |
| S7 build | see the progress entry | exit 0; artifacts in `dist/` |

## Residuals (open)

- **R1 — the turn-side detector fires on the LAST paragraph only.** A verdict stated mid-report and followed by unrelated prose does not fire (the measured incident would: its refusal LINE was the closing verdict). Widening it risks flagging a successful report that narrates a blocked route — the negative case is pinned by a test.
- **R2 — the live host binary predates this change**: the `planstatus` TOOL inside the running session cannot show the new line until the next install; the live check ran through the current source (`experiments/2026-10-14_stop-claim-form/live-planstatus.ts`).
- **R3 — the 8 parked plans stay unfixed ON PURPOSE** (owner: the Codex plan is the red example); writing their stop claims is the owners' action, and the report now names exactly what each one lacks.

## Envelope (G4)

- action classes: READ (grounding), PLAN_WRITE (`plans/`, `agi_workout/`, `_progress_log.md`), MODIFY_PROJECT (`src/util/stop-claim.ts`, `src/util/plan-status.ts`, `src/session/stop-check.ts`, tests, `docs/`).
- prohibitions: `prompt_kernel/**` (the kernel text half belongs to t42's own lane), `bin/`, `git add -A`, `--no-verify`, full `bun test`, branch/worktree changes, hand-fixing the parked plans.
- branch: `Local_Development`, same tree (other robots work on disjoint paths).

## Out of scope

Kernel text for the stop claim (`source.py` rewires — t42's own delivery); FIXING the 8 parked plans (they are the red set this check exists to surface — their stop claims are the owners' next decision); `plans/futures/` and `plans_deferred/` (a candidate and an exclusion are not stop claims).

## Rollback

`git revert` of the commit: both halves are additive (a new leaf module, one new scan + line in `plan-status.ts`, one new detector in `stop-check.ts`); no stored data is migrated.
