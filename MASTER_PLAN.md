<!--
intention: the ONE document that says where the development actually stands — goal, plans, per-task
manifests and their distance to done — so no session has to reconstruct that from memory or from a
transcript. It lives at the repo ROOT and is never moved to plans_completed/: it is a summary of the
work, not a unit of it, and planstatus/reconcilePlans must not see it.

NOT hand-maintained for long: `svm render` (plan S4) regenerates this file from the plan files and the
SVM store. Until that lands, this file IS the rendered form — written once, by hand, on 2026-09-29.
-->
# MASTER PLAN

**Updated:** 2026-09-29 · **Source of truth:** the plan files (state) + the SVM store (direction).

## Goal — level 0

Make the agent's continuity mechanical rather than remembered: every turn opens from a known,
verifiable state (kernel §1.4 SVM), every mechanism carries the granularity of the scale it serves,
and nothing is claimed done without an instrument that could have failed. Current focus: the turn
loop itself (stall, snapshot, automode) before any new surface.

## Where the work stands

| | count |
|---|---|
| plans completed | 177 |
| plans active | 13 |
| tasks passed / total | 605 / 814 |
| open boxes | 54 |
| misplaced plans | 1 (`plans/2026-09-29_bash-tool-single-execution-path.md` — wrong terminal) |

## Active plans

| plan | open | what it is for |
|---|---|---|
| `2026-09-29_svm-tool-and-master-plan.md` | 6 | the manifest store, the tool, the reminder, this file |
| `2026-09-29_stall-reproducer.md` | 4 | reproduce the 20–36 s post-input stall, name the phase |
| `2026-09-29_codegraph-impact-decoupling.md` | 3 | codegraph off the turn path; C3 refuted by measurement |
| `2026-09-29_cua-windows-debug-input.md` | 9 | addressable visual observation + bounded mouse input |
| `2026-09-29_h2-session-pool-and-connection-badge.md` | 2 | session pool reuse; sidebar glyphs |
| `2026-09-26_unified-settings-layers.md` | — | one filled layer chain: global → worktree → session |
| `2026-09-26_fold-carrier-integrity.md` | — | what the fold carries and how absence is represented |
| `2026-09-27_mechanical-s-cadence.md` | — | the mechanical layer-1 row, its cadence and its panel |
| `2026-09-28_kernel-candidate-incorporation.md` | — | the port of the reviewed kernel candidate |
| `2026-09-28_constitution-parity-and-grouped-commits.md` | — | constitution parity, commit grouping |
| `2026-09-27_dap-debugger.md` | — | Delphi/JS debugger over DAP |
| `2026-09-24_pre-fix-artifact-verification.md` | — | verifier for pre-fix artefacts |
| `2026-09-24_to-be-confirmed-shelf-triage.md` | — | triage of the to_be_confirmed shelf |

## SVM — the manifests of what is IN FLIGHT

Per-task manifests, YAML. `eta_turns` is the approximate number of turns until that plan moves to
`plans_completed/`. `state`: doing | blocked | verified | waiting-on-user.

```yaml
- task: S1b
  plan: plans/2026-09-29_svm-tool-and-master-plan.md
  sv:
    keywords: { svm-store: 0.6, fixture-layers: 0.4 }
    dominant: round-trip test for the manifest store against a throwaway instance
  eta_turns: 1
  state: doing
  oracle: bun test test/session/svm.test.ts (S1 shipped without it; red tree was not left behind)

- task: S2
  plan: plans/2026-09-29_svm-tool-and-master-plan.md
  sv:
    keywords: { svm-tool: 0.5, three-verbs: 0.3, render: 0.2 }
    dominant: the svm tool — read|set|render — with the registry spelling discipline
  eta_turns: 3
  state: waiting-on-user
  oracle: set→read round-trips every field; a task with no manifest reports missing, never invented

- task: R1
  plan: plans/2026-09-29_stall-reproducer.md
  sv:
    keywords: { stall: 0.5, clone-fixture: 0.3, five-turns: 0.2 }
    dominant: the stall is named by a measured phase, not by argument
  eta_turns: 3
  state: blocked
  oracle: turn.prepare shows requestMs inside 20–36 s in at least one of five turns
  note: clone fixture works; first turn measured 881 ms, so the fixture is what to change

- task: AUTOMODE-WAIT
  plan: plans/2026-09-29_svm-tool-and-master-plan.md
  sv:
    keywords: { automode: 0.5, no-barrier: 0.3, via-db: 0.2 }
    dominant: the snapshot barrier belongs to interactive turns only; automode state reaches the server through the DB
  eta_turns: 2
  state: doing
  oracle: an automode turn does not wait for the previous commit; leaving the mode settles it

- task: CLOSE-RECOVERY
  plan: plans/2026-09-29_svm-tool-and-master-plan.md
  sv:
    keywords: { plain-close: 0.5, fossil-changes: 0.3, catch-up: 0.2 }
    dominant: a plain app close leaves the unfinished sync recoverable on the next start
  eta_turns: 2
  state: doing
  oracle: fossil changes on start reports the remainder and the commit catches up; cheap variant first
```

## Recursion — how this file stays true

```
goal (level 0)
 └─ plan            ← the plan file owns its tasks and their boxes
     └─ task         ← the task owns its SVM (vector, plan ref, eta_turns)
         └─ oracle   ← the instrument that would prove it, named before the work
```

`render` walks exactly this tree: plan files give what exists and what passed, the SVM store gives
direction and distance. Nothing here is written twice — if a number in this file disagrees with a plan
file, the plan file wins and this file is regenerated.

## Standing rules that outlive any plan

- Instrument before claim: no `[x]` without a run id, a hash or a rehearsal log.
- A refutation is a result, not a detour — C3 above was retired by one measurement.
- Absence of an oracle reads as FALSE to the user; a status surface renders a value, never nothing.
- Nothing under `bin/`; a render claim needs a rebuilt candidate.
- Memory carries only what has no other home — this file is one of those homes now.
