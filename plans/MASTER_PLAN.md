<!--
intention: the ONE document that says where the development stands — goal, the plans that exist, and the
CHECKS that keep it true — so no session has to reconstruct that from memory or from a transcript. It lives
IN `plans/`, beside the plans it maps, because that is where a reader looks (owner, 2026-09-30: «master plan
должен быть в планах, а не в корне иначе его никто читать не будет»), and it is CANON, not a plan:
`NON_PLAN_FILES` in `util/plan-status.ts` skips it by name, so neither the status report nor `reconcilePlans`
can ever file the map of all work into `plans_completed/`.

IT IS A ROUTER, NOT A COPY (owner, 2026-09-30: «ничего наш копир больше копировать не должен — просто
проверять, есть в мастер плане или нету»). Nothing about a plan is retyped here: a retyped vector is a SECOND
SOURCE that agrees with its plan on the day it is written and drifts from the next day, and the reader is then
left to decide which of the two is real. What this file owns is the GOAL (nothing else states it), the MAP
(which plans exist), and the CHECKS.

NOT hand-maintained for long: `svm render` (plan S4) prints each entry's vector INTO this file from its
source, verbatim — read, never retyped.
-->
# MASTER PLAN

**Updated:** 2026-09-30 · **Sources of truth:** the plan files (state) + the SVM store (direction). This file
copies neither; it routes to them and checks them.

## Goal — level 0

Make the agent's continuity mechanical rather than remembered: every turn opens from a known,
verifiable state (kernel §1.4 SVM), every mechanism carries the granularity of the scale it serves,
and nothing is claimed done without an instrument that could have failed. Current focus: the turn
loop itself (stall, snapshot, automode) before any new surface.

```yaml
sv:
  keywords: { agent-continuity: 0.35, mechanical-state: 0.25, proof-not-claim: 0.25, turn-loop-first: 0.15 }
  dominant: Continuity stops depending on memory — every turn opens from a known state, and nothing is called done without an instrument that could have failed.
```

The goal's vector is the ONE vector this file owns: nothing else states the goal, so it cannot be read from a
source. Every vector below the goal is READ from where it lives (next section) — and the goal is the anchor
`parent-goal-md5` points at, which is the reason it carries one at all (asked by an outside reader, 2026-09-30:
«почему у goal нету семантического вектора»).

## Where the work stands

| | count |
|---|---|
| plans completed | 177 |
| plans active | 14 |
| tasks passed / total | 609 / 818 |
| open boxes | 54 |
| misplaced plans | 1 (`plans/2026-09-29_bash-tool-single-execution-path.md` — the mechanical rule reads its two `[~]` items as closable; they are NOT done, and moving it would declare unfinished work complete) |

A READING, not a copy: these numbers come from `planstatus`, which walks `plans/` and `plans_completed/`
itself, and the same numbers ride the turn note every turn. A number here that disagrees with the tool means
this table is stale — re-read the tool, do not re-type the table.

## The map — presence, and where every vector is READ from

**RULE (owner, 2026-09-29, restated 2026-09-30): an SV is mandatory for every subplan, task and link** —
«чтобы было четко ясно, нафига это все и с чем это коррелирует». **And this file does not hold copies of
them.** An entry's vector is read from its own source:

| entry | where its vector lives | how a reader gets it |
|---|---|---|
| a plan | its `<!-- intention: from -> to -->` and `<!-- goal_sv: … -->` header | read the plan FILE |
| a task | the `<!-- sv: … -->` tag on its own box | read the plan FILE |
| an in-flight task's direction, distance, oracle | the SVM store, key `["svm","task",<plan>,<task>]` | `svm read <plan> <task>` |

`svm render` (S4) will print those into this file **from the source, verbatim**. Until it lands, the map below
names what exists and the checks below are what actually run — a missing vector is a MISSING line, never a
polite blank.

### The check: coverage

`masterPlanCoverage(worktree)` — **every plan file under `plans/` must be named here**, and it returns the gaps
by name. It is printed by `planstatus` whether it is clean or not, because a check whose silence cannot be told
from its absence is not a check. Measured on its first run: `plans/2026-09-29_bash-tool-single-execution-path.md`
was under `plans/` and named nowhere, which is exactly what the first outside reader of this file asked about
(«почему не все планы в мастер плане»).

### The question (it is a question, and it is asked every turn)

The instrument can check PRESENCE; only the sources can answer whether this file is still TRUE. So the turn
note asks, unobtrusively and every time:

> `map: N un-ticked box(es) across M plan(s) — is each one accounted for in plans/MASTER_PLAN.md, and does it
> still match the plan file it came from?`

Owner, 2026-09-30: «ненавязчиво спрашивать, как непроставленные галки соотносятся с мастер планом, и требовать
сопоставления с исходниками, это также для того чтобы больше охоты оставлять незавершенные планы в планах не
было». A command would be satisfied by editing the note's own output; a QUESTION is only satisfied by the plan
file and the code — and a plan left open keeps being asked about, which is the pressure.

### The plans that exist right now

Presence only — what each is for is in its own header, and whether it is done is in its own boxes.

- `plans/2026-09-24_pre-fix-artifact-verification.md`
- `plans/2026-09-24_to-be-confirmed-shelf-triage.md`
- `plans/2026-09-26_fold-carrier-integrity.md`
- `plans/2026-09-26_unified-settings-layers.md`
- `plans/2026-09-27_dap-debugger.md`
- `plans/2026-09-27_mechanical-s-cadence.md`
- `plans/2026-09-28_constitution-parity-and-grouped-commits.md`
- `plans/2026-09-28_kernel-candidate-incorporation.md`
- `plans/2026-09-29_bash-tool-single-execution-path.md`
- `plans/2026-09-29_codegraph-impact-decoupling.md`
- `plans/2026-09-29_cua-windows-debug-input.md`
- `plans/2026-09-29_h2-session-pool-and-connection-badge.md`
- `plans/2026-09-29_stall-reproducer.md`
- `plans/2026-09-29_svm-tool-and-master-plan.md`
- `plans/2026-09-30_replacement-empty-assistant-row.md`

## Recursion — how this file stays true

```
goal (level 0)      ← the one vector this file owns
 └─ plan            ← the plan file owns its tasks, their boxes and their vectors
     └─ task         ← the task owns its SVM (vector, plan ref, eta_turns) in the store
         └─ oracle   ← the instrument that would prove it, named before the work
```

`render` walks exactly this tree: plan files give what exists and what passed, the SVM store gives direction
and distance, and this file prints what they say instead of saying it twice. Its contract is not a new one — it
is `plans/2026-09-29_svm-tool-and-master-plan.md` → task **S4**, which carries the acceptance (two renders in a
row byte-identical; **no rendered plan, task or link without its sv**; the goal at level 0 carries its own;
every plan under `plans/` is named).

**Measured 2026-09-30 on an outside reader** (no frame, no tools, no session — `aicall`, `space-bunny-free`,
brief and reply in `experiments/2026-09-30_masterplan-gravity/`): given only the repo root listing and this
file, it named this file third — «next as a **state router**, not as an implementation specification» —
reproduced the precedence rule, and named S4 as the next action **with its oracle**. Then it named the one
thing missing: the handoff permitted «until that lands» without saying what would run it. That is why the
renderer's contract is stated above in this file rather than only in the plan.

## Standing rules that outlive any plan

- Instrument before claim: no `[x]` without a run id, a hash or a rehearsal log.
- A refutation is a result, not a detour — a premise dies from one measurement, and that is progress.
- Absence of an oracle reads as FALSE to the user; a status surface renders a value, never nothing.
- Nothing under `bin/`; a render claim needs a rebuilt candidate.
- Memory carries only what has no other home — this file is one of those homes now.
- **Nothing here is a copy.** A fact that lives somewhere else is ROUTED to, not repeated: a second source
  agrees today and drifts tomorrow, and the reader is left deciding which one is real.
