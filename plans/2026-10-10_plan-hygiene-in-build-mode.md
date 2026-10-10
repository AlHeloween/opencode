<!-- intention: plan hygiene (reconcilePlans) is invoked only from AGI mode and by construction never ticks a box, so finished plans pile up in plans/ and the debt only grows -> every ordinary turn repairs plans/ itself (finished plans move to plans_completed/), and the accumulated plans are swept per protocol: green oracle -> box ticked with an artifact -> move -> docs; anything new that surfaces becomes a NEW plan. -->

# Plan hygiene in build mode + closing the accumulated plans

**Status:** ACTIVE — M1 done 2026-10-10 (commit `9d4174ee41`); M2 (the TUI half) and SW (the sweep) are open. Owner, 2026-10-10, verbatim: «В том то все и дело что большая часть этих планов выполнена, у нас есть серьезный баг и его надо решить: смотри по протоколу - если все оракулы окей, план взяли и поместили в завершенные, обновили доки. Если потом чего вылезло - делаем новый план.» Also: «люди … слишком налегают на греп без codegraph» — the sweep below obeys that: the graph is asked first, grep only as a negative text control.

## 0. Grounding (read with instruments, 2026-10-10)

| # | Fact | Instrument |
|---|------|-----------|
| G1 | `reconcilePlans` (`util/plan-status.ts:733`) — its own doc: «Does not edit checkbox content — only moves files by open-item presence»; it moves `plans/*` → `plans_completed/` only when `isFinished(src)` (`:757-759`) | codegraph node (verbatim body) |
| G2 | Callers of `reconcilePlans` = 5: `runPlanHygiene`, the `planstatus` tool (only with `reconcile:true`), tests, one experiment file. **No session-start / turn-boundary caller.** | codegraph callers |
| G3 | `runPlanHygiene` (`agi-mode.tsx:283`) is called only from `useAgiMode`, at `:467` and `:653`; `refreshPlanStatus` at `:718` sits inside `toggleAgiMode()` | codegraph callers + call-site grep |
| G4 | Both call sites are behind `if (agiMode())` (`:431`) ⇒ in an ordinary build session plan hygiene **never fires** | read `agi-mode.tsx:431,440-479,702-729` |
| G5 | Plan state is already read on every turn, server-side: `planDebt` / `couplingFindings` / `criticalRisks` at `session/prompt.ts:2009-2096`, `collectPlanState` at `:2610` — the debt line is **reported** and never repaired | grep + read |
| G6 | `reconcilePlans` does **not** update docs — it only moves files | verbatim body, G1 |

## 1. Claim ledger

- **C1.** Plan hygiene must run in ANY mode, not only AGI. *Falsifier:* a finished plan stays in `plans/` after an ordinary turn. *Pin:* `agi-mode.tsx:431` (the guard that hides it).
- **C2.** `isFinished`-only is sufficient: a plan with an open box must never move. *Falsifier:* a plan carrying `- [ ]` lands in `plans_completed/`. *Pin:* `plan-status.ts:757-759`.
- **C3.** After the pass the note's debt must be zero, i.e. the reported state and the tree cannot disagree. *Falsifier:* the note prints `misplaced` > 0 while the tree has none.
- **C4.** A sweep box may be ticked only against an oracle named by its own plan and re-run today. *Falsifier:* a ticked box whose declared test does not exist or was not run. *Pin:* `_progress_log.md` entry per closed plan.

## 2. Risk ledger

- **R1 (critical).** An automatic move touches the worktree during prompt assembly. *Containment:* `isFinished` only, idempotent, errors collected into `log.warn`, never thrown; the move is captured by the next fossil boundary and is named in the turn note.
- **R2.** `reconcilePlans` also *reopens* incomplete kernel-authored plans from `plans_completed/` → `plans/`. *Containment:* do not split the function (one spelling); watch the first run's `reopenedToActive` count and log it.
- **R3 (critical, sweep).** Ticking a box whose work is not done is JOB FAILED in the opposite direction. *Containment:* per `C4`; a box with no runnable oracle today is **left alone** and reported, never ticked.
- **R4.** Moving a plan that another session is editing. *Containment:* the move is a `git mv`-equivalent rename recorded in the note; `isFinished` means the author already closed it.

## 3. Tasks

- [x] **M1 — the mechanism.** DONE 2026-10-10, commit `9d4174ee41`. `reconcilePlans(worktree)` runs in `session/prompt.ts` immediately BEFORE the note's one read of the plan tree (the block now at `:2046-2066`; `const plans = parsePlanFiles(worktree)` at `:2067`), so the debt the note prints is the tree's own. Errors collected and logged; the call is guarded because a throw on the prompt path would take every turn with it. Oracle, three runs of `test/util/plan-status.test.ts`, ONE FILE PER INVOCATION: baseline 23 pass/0 fail/67 expect (`20261010T190047Z_cf1a50c4`) → 25/0/72 (`20261010T190222Z_30bcd83b`); MUTATION, call removed, 24 pass/1 fail/71 expect exit 1 (`20261010T190320Z_5bf21a74`); restored from `.bak` → 25/0/72 (`20261010T190331Z_f9bc042a`). `bun typecheck` exit 0 (`20261010T190248Z_ffc3cb28`); `_build.ps1` green, `dist/bin/opencode.exe` 303 793 664 B relanded.
- [ ] **M2 — the TUI half.** The plan panel must reflect the same pass rather than only AGI activation (`agi-mode.tsx:718`). Oracle: the status surface shows the post-pass state; absence renders FALSE (AGENTS invariant).
- [ ] **SW — the sweep of the accumulated plans.** Owner, 2026-10-10: «большая часть этих планов выполнена… если все оракулы окей, план взяли и поместили в завершенные, обновили доки. Если потом чего вылезло - делаем новый план.» For each plan in `plans/`, ONE plan at a time: read its boxes → for each box whose work appears done, find the oracle **named in that plan** → run it TODAY, one file per invocation → tick with the run id → when no open box remains, `git mv` to `plans_completed/` in a commit naming the plan → update docs if the plan changed them. A box with no runnable oracle today is LEFT ALONE and reported (`R3`); anything genuinely undone becomes a **new** plan, never a reopened one.

## 4. Smoke Tests

- Baseline: `bun test test/util/plan-status.test.ts` — PASS before the edit (existing suite; `reconcilePlans` already has a test file).
- Post: the M1 test RED on the missing call → GREEN; `bun typecheck` from `packages/opencode` exit 0; `_build.ps1` green after the tests.
- Sweep: for every closed plan, its own declared oracle re-run today, one file per invocation, run id recorded in the plan and in `_progress_log.md`.

## 5. Rollback

Code: reverse scoped hunks in `session/prompt.ts` (+ the test). Plans: `git mv` back with the same basis named in a commit. No whole-file git restore.
