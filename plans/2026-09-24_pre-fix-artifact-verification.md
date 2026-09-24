<!-- intention: everything produced while the buggy kernel was in force carries its distortions (narration instead of grounding; "not found" verdicts from a closed instrument list; stalls left as circles) -> every artifact inside the measured window carries an instrument-backed status, corrections land, and what remains is a listed queue -->
# Pre-fix artifact verification — the kernel bug's blast radius

**Status:** ACTIVE. Branch: `Local_Development`.

## G0–G1: the instruction and its suspect classes

Owner, 2026-09-24, verbatim: «с этого момента все что было до этого момента подлежит строгой проверке и корректировке, потому что у нас был баг в кернеле и мы его только что починили.»

The bug was fixed and released in `5a06a07f40` (record: `docs/kernel-release-2026-09-24.md` §Why). Three measured mechanisms — they distort TEXT the same way they distorted behaviour:

1. **The pre-action section tripled** (G0+G1: 2 840 B → 7 309 B). An imperative that is not a call can only be satisfied by PROSE ⇒ narration reported as work.
2. **The instrument chain read as a FENCE.** A closed list makes "instrument" mean "one of these host tools", so an agent that found no listed tool reached for the most impressive thing it could not steer, or declared absence.
3. **A non-PASS had no forward edge.** A STALL was a circle, and `loop_budget` had no value, so parked Unknowns had no lawful exit.

⇒ Three suspect classes in every artifact written under that prefix:

- **N — narration-as-work.** Claims whose instrument was never run, or sits below the claim's layer.
- **F — false absences.** "Not found" / "absent" verdicts reached from a closed list instead of a built instrument (the class AGENTS.md names: an absence needs a validated probe with a positive control).
- **S — open circles.** Work parked in Unknown/STALL with no forward edge taken.

The window is MEASURED, not guessed: `prompt_kernel/dist/` keeps a dated render per kernel edit, so T1 finds the render where the pre-action mass stepped up; the window is (that render … `5a06a07f40`).

**The plan side is already the owner's shelf.** `plans/to_be_confirmed/readme.md` (the 2026-09-24 code audit, 18 plans, each with its own return condition: what to re-verify before the plan resumes or closes) IS the plan-side inventory — this plan builds no second one; it covers the distortion classes inside the measured window and consumes that shelf as its input.

| Acceptance | Surface | Oracle | Falsifier |
|---|---|---|---|
| C1: the window is measured | `prompt_kernel/dist/*_reasoning_prompt.txt` | per-render G0+G1 byte series with the step named | a claimed window whose boundary render shows no step |
| C2: every in-window unit carries a status | plans touched in-window, memory blocks, shipped commits | each claim re-instrumented, or `Unknown` with its falsifier | an in-window claim still standing on prose alone |
| C3: corrections land through their own cycle | the corrected artifacts | each correction carries an oracle; the remainder is a listed queue | a claim deleted without a contradictor, or a reading promoted to a verdict |

## G2–G4: tasks

- [x] **T1 — measure the window.** ✓ Instrument: `experiments/2026-09-24_prefix-window/measure.mjs` — the SAME definition as `prompt_kernel/tests/test_render.py:206` (`<G0_RULES>` + `<G1_RULES>` bytes, so the series is comparable to the release's numbers; it reproduces them: 2 862 B where the release wrote 2 840 on the same 09-17 artifact) applied to the 166 dated renders in `prompt_kernel/dist/`. Deliverable: the growth is a STAIRCASE, not one step — 1 635 B (09-07) → 2 862 B at the battle-tested 09-17 render → 3 177 / 4 126 / **5 458 B at 09-20 18:38 (+1 302 in one render)** → 6 092 B at 09-21 22:53 (+634) → **7 117 B at 09-23 00:11 (+1 025)** → peak **7 331 B at 09-24 18:14** → 5 301 B after the 21:23 fix. G1 bullets 9 → 32 over the same span.
  ⇒ **Window for this plan: artifacts authored 2026-09-20 → 2026-09-24 22:08** (the drift begins in the 09-20 morning renders; the four big steps are 09-20 18:38, 09-21 22:53, 09-23 00:11, 09-24 18:14). Report: `experiments/2026-09-24_prefix-window/measure-report.txt`.
- [ ] **T2 — inventory the in-window units.** The PLAN side is `plans/to_be_confirmed/readme.md` — the owner's per-plan return conditions, not a second inventory of ours. Add the remaining units: memory blocks written in the window and the shipped commits (`git log`). Deliverable: the list §C2 is computed over.
- [ ] **T3 — verify per class N/F/S.** Per unit: re-run the instrument its claims name (N); re-test each absence verdict with a built instrument and a positive control (F); route each parked Unknown forward or bound it (S). Verification only — no corrections here.
- [ ] **T4 — corrections.** Each failed claim: a bounded edit with its oracle, or a recorded `Unknown` with its falsifier; the remaining queue is LISTED, not described (the owner's own norm: memory as a gap queue).

Envelope: T1–T3 read-only; T4 `MODIFY_PROJECT`, per-item, recorded in `_progress_log.md`. Prohibitions: no kernel edit; no `bin/` touch; no rewriting history (a correction is a new commit naming the claim it corrects).
Rollback: T1–T3 none needed; T4 by `git diff` per item.

## Smoke Tests

- **BEFORE:** the class is reproducible — a live in-window artifact whose claim carries no instrument of its layer (named in T2's inventory).
- **AFTER:** every in-window unit carries a status (instrument-backed ✓ or a bounded `Unknown`); the queue is empty or listed with its falsifiers.

## Claims

| claim | falsifier | rung |
|---|---|---|
| The three mechanisms distort artifacts, not only behaviour | an in-window artifact whose claims all carry instruments of their layer | Inferred — the release measures the TEXT; S2 (`20260924T152119Z`… run `ses_f2d350cd…` census) measured the behaviour |
| The pre-action mass grew in ONE step, not gradually | a series with no single step | ✗ REFUTED by T1: it staircased — four big steps, 2 862 → 7 331 B across 09-20…09-24 |
| Corrections are safe to make in the same cycle as verification | a correction that changes the claim it verifies | open — T4 keeps them separate |

## Residual

None yet — the plan owes T2–T4. S2/S3 are the residual of `plans_completed/2026-09-24_grounding-first-and-boundary-reporting.md`; S2 read once there (the tool-first share did not move; the fold-boundary window carries no tool demonstration). **S3 FIRST READING, 2026-09-24:** between the approval of the gateway-marker plan (`15:18:40`) and its closure (commit `1ba4666725`, `15:25:20`) this session emitted **12 text parts / ~2 149 chars**, each announcing a step's result; the per-item AUTHORIZATION re-ask is gone (0 occurrences), the per-item REPORTING is not. No pre-change baseline was ever taken — a reading, not a ratio.
