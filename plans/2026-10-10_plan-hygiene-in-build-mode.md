<!-- intention: plan hygiene (reconcilePlans) is invoked only from AGI mode and by construction never ticks a box, so finished plans pile up in plans/ and the debt only grows -> every ordinary turn repairs plans/ itself (finished plans move to plans_completed/), and the accumulated plans are swept per protocol: green oracle -> box ticked with an artifact -> move -> docs; anything new that surfaces becomes a NEW plan. -->

# Plan hygiene in build mode + closing the accumulated plans

**Status:** DRAFT. Owner, 2026-10-10, verbatim: «В том то все и дело что большая часть этих планов выполнена, у нас есть серьезный баг и его надо решить: смотри по протоколу - если все оракулы окей, план взяли и поместили в завершенные, обновили доки. Если потом чего вылезло - делаем новый план.» Also: «люди … слишком налегают на греп без codegraph» — the sweep below obeys that: the graph is asked first, grep only as a negative text control.

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

- **M1 — the mechanism.** Call `reconcilePlans(worktree)` on the path that runs in every mode, immediately before the debt is computed in `session/prompt.ts` (near `:2049`), so the note reports the repaired tree. Errors → `log.warn("bug: plan hygiene failed …")`, never a throw. Oracle: a new test — a `plans/*.md` with zero open boxes lands in `plans_completed/` on the pass, and a file with `- [ ]` stays.
- **M2 — the TUI half.** The plan panel must reflect the same pass rather than only AGI activation (`agi-mode.tsx:718`). Oracle: the status surface shows the post-pass state; absence renders FALSE (AGENTS invariant).
- **S1…Sn — the sweep.** For each plan in `plans/`, one plan at a time: read its boxes → for each box whose work appears done, find the oracle **named in that plan** → run it today, one file per invocation → tick with the run id → when no open box remains, `git mv` to `plans_completed/` in a commit naming the plan → update docs if the plan changed them. Anything that surfaces as genuinely undone becomes a **new** plan (owner's protocol), never a reopened one.

## 4. Smoke Tests

- Baseline: `bun test test/util/plan-status.test.ts` — PASS before the edit (existing suite; `reconcilePlans` already has a test file).
- Post: the M1 test RED on the missing call → GREEN; `bun typecheck` from `packages/opencode` exit 0; `_build.ps1` green after the tests.
- Sweep: for every closed plan, its own declared oracle re-run today, one file per invocation, run id recorded in the plan and in `_progress_log.md`.

## 5. Rollback

Code: reverse scoped hunks in `session/prompt.ts` (+ the test). Plans: `git mv` back with the same basis named in a commit. No whole-file git restore.
