<!-- intention: 19 plans sit on plans/to_be_confirmed/ after the 2026-09-24 audit — four of them owner-confirmed as shipped and live-tested, one (TUI gateway row) awaiting a confirmation run, the rest awaiting re-verification against current code — while planstatus cannot see the shelf at all -> every file on the shelf reaches a proven terminal (plans_completed/ with evidence, plans/ with a single named remaining criterion, or a lawfully shelved terminal), and the shelf readme states the result -->
# to_be_confirmed shelf triage — every shelf file to a proven terminal

**Status:** ACTIVE — authorized 2026-09-24 (owner: «Давай»). Branch: `Local_Development`.

## G0–G1: the shelf, its classes, and the rule of the move

The shelf `plans/to_be_confirmed/` (19 plan files + `readme.md`) was created 2026-09-24 by owner
decision after the plans↔code audit. The shelf's own readme names, per plan, the return condition →
this plan executes THAT list; it builds no second inventory. `collectPlans` is flat by design, so
nothing on the shelf appears in `planstatus`/`owed`, and every move is a `git mv` whose commit names
the ground (`plans/README.md` §Plan state; shelf readme).

Three classes, handled in this order:

1. **Four owner-confirmed plans** — `2026-09-21_agents-variant-ctrl-t-cycle`, `2026-09-23_automode-slash-command`,
   `2026-09-24_chatgpt-oauth-cache-efficiency`, `2026-09-24_tui-model-pick-current-session`. Owner
   confirmed implementation and live testing; their open lines are RECORD debt, not an instruction to
   repeat the test. Close = locate the recorded result, match the boxes and links to it, drop stale
   notes (e.g. the «live smoke NOT yet run» mark), move to `plans_completed/`. A re-run only on a NEW
   material doubt.
2. **TUI gateway-row plan** — `2026-09-24_tui-effective-gateway-protocol`. Fix + narrow tests passed
   2026-09-24 (owner record). Remaining: confirm the status-row text and the single-request transport
   on an ISOLATED candidate, then close. Live `bin/` is not touched — the owner named the live-`bin/`
   attempts as the cause of the earlier hangs.
3. **The remaining 14** — each re-verified against current code and its own acceptance criteria before
   return; some notes are already suspect (the readme names `fill-chain`'s `canonicalIdentity` note as
   possibly stale). Outcome per file: completed with evidence → `plans_completed/`; live remainder →
   back to `plans/` with the ONE remaining criterion named; or `postponed/`/`futures/`/`plans_deferred/`
   by rule. Never «completed» because similar code exists.

Acceptance frame:

| Acceptance | Surface | Oracle | Falsifier |
|---|---|---|---|
| C1: the four confirmed plans are closed with boxes matched to recorded results | the four files → `plans_completed/` | each formerly open line cites its located evidence, or the owner's confirmation marked «evidence not located»; `planstatus` counts the files completed | a line ticked by resemblance to code or by memory alone |
| C2: the gateway-row plan closes on an isolated-candidate confirmation | the plan file → `plans_completed/` | run on the isolated candidate per that plan's own criteria; log recorded; live `bin/` untouched | confirmation read from docs instead of a run |
| C3: each of the remaining 14 files has a proven terminal | shelf files + `plans/` + terminal shelves | per-file verdict recorded in `_progress_log.md`; `git mv` naming the ground; no file left on the shelf without a named reason | a file moved on resemblance, or left shelfed unnamed |
| C4: the shelf readme states the final disposition | `to_be_confirmed/readme.md` | readme matches the tree; `planstatus` shows no misplaced | a stale readme row |

## Prior art (REUSE.BEFORE)

- `plans/to_be_confirmed/readme.md` — the per-plan return conditions: **the input**, reused, not re-derived.
- `plans/README.md` — the terminal canon (five shelves), the four state forms, the noChecklist rule.
- `util/plan-status.ts` (`reconcilePlans`) — existing placement mechanics; this plan moves by hand with it as reference, because subdirectories are invisible to it by design.
- `plans/2026-09-24_pre-fix-artifact-verification.md` — the N/F/S framework and the measured window; its T2 consumes this shelf's readme as the plan-side inventory (see Risks).

## Tasks

- [x] **T1 — close the four owner-confirmed plans (DONE 2026-09-24).** Unit runs located on disk and cited (agent-model-cell 4/0 + 16/0+tsgo; automode 8/0); the LIVE-run machine records were NOT locatable — measured: the worktree holds no session history for 09-21…24 — so each entry records the owner's confirmation AS its evidence with «machine record not located». All four moved to `plans_completed/`; the shelf readme rows now name the new paths and the evidence.
- [ ] **T2 — close the TUI gateway-row plan.** Confirmation on an isolated candidate (never live `bin/`): row text + single-request transport per the plan's criteria; record the run; move the file.
- [ ] **T3 — re-verify and route the remaining 14.** One file at a time: re-run its acceptance criteria against current code, drop stale items, name the remaining criterion. Deliverable per file: verdict + terminal + `git mv` recorded in `_progress_log.md`.
- [ ] **T4 — settle the shelf readme and the top level.** Update `readme.md` to the final disposition; run `planstatus`; confirm top-level consistency (no misplaced; debt = only the plans lawfully returned to `plans/`).

Envelope: T1/T3 — read-only checks (sessions, code, `git log`) plus `MODIFY_PROJECT` limited to plan files and `git mv` between plan shelves; T2 additionally drives that plan's own candidate oracle; T4 plan-file edits only.
Prohibitions: no product-code edits (a defect found during verification becomes its own bounded item, not a fix inside this plan); no `bin/` access; no history rewrite; no kernel/system-prompt work.
Rollback: `git mv` back; plan-file edits by `git checkout`.
Bounds: per-file verdict ≤ 2 verification attempts; after that record `Unknown` with its falsifier and move on.

## Smoke Tests

- **BEFORE:** `planstatus` recorded — 167/168 plans, 445/602 tasks (99%), misplaced: none, debt 3 open boxes (all in `2026-09-24_pre-fix-artifact-verification.md`); shelf invisible. ✓ Recorded this session, 2026-09-24.
- **AFTER:** each of the 19 shelf files has a proven terminal; `readme.md` matches the tree; `planstatus` consistent; no moved file without its named ground.

## Claims

| claim | falsifier | rung |
|---|---|---|
| The four plans' prior live results are recoverable from session history | for a given plan, searches over the dated sessions and commits return no run/read-back | Inferred — owner confirmation recorded in the shelf readme; recovery not yet attempted |
| The shelf is invisible to `planstatus` | a `planstatus` run that counts a shelf file | ✓ Confirmed — `planstatus` run 2026-09-24 + `plans/README.md` §Active Plans |
| Re-verification before return prevents stale re-entry | a returned plan whose criteria were stale at move time | open — T3 keeps verification and movement in one step |

## Risks

- **Closing by resemblance.** The readme forbids «completed» on the appearance of similar code; containment: every tick cites located evidence or the owner's confirmation; a file with neither stays shelfed.
- **Shared input with the pre-fix plan.** `2026-09-24_pre-fix-artifact-verification.md` T2 reads the shelf readme as its plan-side inventory — T4 updates the readme only after all moves, so the map never diverges mid-sweep.
- **Evidence not located for a confirmed plan.** Containment: the owner's confirmation is recorded as the evidence with that explicit mark; a re-run is the escalation, not the default.

## Not in scope

- `2026-09-24_pre-fix-artifact-verification.md` T2–T4 — its own active plan.
- `plans/advanced_reasoning/` (assertion-marking work) — dedicated section, ACTIVE, not shelfed.
- `plans/futures/`, `plans/postponed/` — lawfully parked; untouched by this triage.
