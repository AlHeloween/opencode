<!--
intention: the ONE document that says where the development actually stands — goal, plans, per-task
manifests and their distance to done — so no session has to reconstruct that from memory or from a
transcript. It lives IN `plans/`, beside the plans it maps, because that is where a reader looks (owner,
2026-09-30: «master plan должен быть в планах, а не в корне иначе его никто читать не будет»), and it is
CANON, not a plan: `NON_PLAN_FILES` in `util/plan-status.ts` skips it by name, so neither the status report
nor `reconcilePlans` can ever file the map of all work into `plans_completed/`. It answers to the same
coverage rule it imposes: every plan under `plans/` must be named here (`masterPlanCoverage` reports the
gaps), and the goal itself carries an SV like every entry below it.

NOT hand-maintained for long: `svm render` (plan S4) regenerates this file from the plan files and the SVM
store. Until that lands, this file IS the rendered form — written by hand, with every vector derived from the
plan's own `<!-- intention: … -->` header.
-->
# MASTER PLAN

**Updated:** 2026-09-29 · **Source of truth:** the plan files (state) + the SVM store (direction).

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

**Why the goal carries a vector at all** — it did not until an outside reader asked for it («почему у goal
нету семантического вектора», 2026-09-30). The rule below says every subplan, task and link carries one, and
a level that exempts itself is the level every other level copies. The goal's vector is also the only place
that says which AXIS the others are children of: `parent-goal-md5` needs an anchor, and an anchor that points
at prose is not an anchor.

## Where the work stands

| | count |
|---|---|
| plans completed | 177 |
| plans active | 14 |
| tasks passed / total | 609 / 818 |
| open boxes | 54 |
| misplaced plans | 1 (`plans/2026-09-29_bash-tool-single-execution-path.md` — the mechanical rule reads its two `[~]` items as closable; they are NOT done, so it is listed below and NOT moved — a move would declare unfinished work complete) |

Counts read from `planstatus` (2026-09-30), which walks `plans/` and `plans_completed/` itself — not retyped
from memory.

## Active plans — every one carries its SV

**RULE (owner, 2026-09-29): an SV is MANDATORY for every subplan, task and link.** «в мастерплане sv для
каждого субплана, таска или линка обязателен, чтобы было четко ясно — нафига это все и с чем это
коррелирует». An entry without one is not readable by the next agent — only guessable, and a guess is
error ADDED. The keywords of a plan's vector are the terms its tasks will share, so the vector is also how
two plans are told apart when they touch the same surface.

The vectors below are hand-derived from each plan's own stated intention (`<!-- intention: … -->` at the top
of the plan file) — that header is where they must migrate, so `svm render` can read them instead of an
author retyping them. A plan-level vector that disagrees with its plan's intention is a defect in this file.

```yaml
- plan: plans/2026-09-29_svm-tool-and-master-plan.md
  open: [S2, S3, S4, S5, S6]
  sv: { keywords: { manifest-store 0.4, svm-tool 0.3, master-plan-render 0.2, turn-reminder 0.1 },
        dominant: "A turn stores and reads its own task manifest, and the master plan renders itself from them." }

- plan: plans/2026-09-29_stall-reproducer.md
  open: [R1, R2, R3, R4]
  sv: { keywords: { post-input-stall 0.45, fossil-commit 0.3, phase-bisect 0.25 },
        dominant: "The 20–36 s stall is reproduced in isolation and named by a measured phase, not by argument." }

- plan: plans/2026-09-29_codegraph-impact-decoupling.md
  open: 3
  sv: { keywords: { codegraph-off-turn-path 0.4, footer-reader 0.3, indexer-domain-code-only 0.3 },
        dominant: "Impact reaches the footer from sources that exist, and the graph sync leaves the turn's critical path." }

- plan: plans/2026-09-29_cua-windows-debug-input.md
  open: 9
  sv: { keywords: { windows-input 0.4, capture-bound-drag 0.35, addressable-screenshot 0.25 },
        dominant: "An agent obtains an addressable visual observation and bounded, verifiable Windows mouse input." }

- plan: plans/2026-09-29_h2-session-pool-and-connection-badge.md
  open: 2
  sv: { keywords: { h2-session-pool 0.45, connection-badge 0.3, stream-concurrency 0.25 },
        dominant: "Concurrent provider streams ride a reused HTTP/2 pool, and the sidebar shows the living connection." }

- plan: plans/2026-09-29_bash-tool-single-execution-path.md
  open: 2
  sv: { keywords: { one-execution-input 0.4, cmd-quoting 0.35, tests-on-production-paths 0.25 },
        dominant: "bash and cmd share ONE execution input and their tests run on the production paths, not on a parallel harness." }
  note: delivered and verified except `K4` (the silent `Shell.select()` fallback) and `C6` (`as any` on the background return) — both `[~]`, both named as NOT done. This is the plan an outside reader found missing from this file («почему не все планы в мастер плане», 2026-09-30), and it is the one file `planstatus` calls misplaced.

- plan: plans/2026-09-30_replacement-empty-assistant-row.md
  open: 3
  sv: { keywords: { replacement-path 0.4, empty-assistant-row 0.3, interrupted-step 0.3 },
        dominant: "The turn-replacement path stops leaving an empty assistant row, or the test states why one may exist." }
  note: a real red (`test/session/prompt.test.ts`), measured as NOT caused by S1–S3 — an interrupted loop step leaves a `parts: []` assistant row

- plan: plans/2026-09-26_unified-settings-layers.md
  sv: { keywords: { fill-not-resolve 0.45, layer-chain 0.3, read-is-a-lookup 0.25 },
        dominant: "Settings layers are filled once at creation and read by plain lookup — no parent walk at read time." }

- plan: plans/2026-09-26_fold-carrier-integrity.md
  sv: { keywords: { fold-carrier 0.4, absence-has-an-address 0.35, continuity 0.25 },
        dominant: "What a fold drops keeps an address, and absence is representable rather than silent." }

- plan: plans/2026-09-27_mechanical-s-cadence.md
  sv: { keywords: { mechanical-row 0.4, cadence 0.3, zero-model-calls 0.3 },
        dominant: "The mechanical layer-1 row is produced on its own cadence with no model call in the cycle." }

- plan: plans/2026-09-28_kernel-candidate-incorporation.md
  sv: { keywords: { kernel-candidate 0.5, pipeline-not-hand-edit 0.3, gate-addons 0.2 },
        dominant: "The reviewed kernel candidate lands through the render-test-install pipeline, never by hand." }

- plan: plans/2026-09-28_constitution-parity-and-grouped-commits.md
  sv: { keywords: { constitution-parity 0.45, one-plan-one-commit 0.3, plan-hygiene 0.25 },
        dominant: "Constitution and kernel stay in parity, and a plan's work lands as one commit that names it." }

- plan: plans/2026-09-27_dap-debugger.md
  sv: { keywords: { dap 0.5, delphi-js-debugging 0.3, session-adapter 0.2 },
        dominant: "Delphi and JS debugging arrives over DAP, driven by the same oracle discipline." }

- plan: plans/2026-09-24_pre-fix-artifact-verification.md
  sv: { keywords: { pre-fix-artifact 0.5, read-back-oracle 0.3, write-path 0.2 },
        dominant: "A write-path change is verified by reading the artifact back, never by its typecheck." }

- plan: plans/2026-09-24_to-be-confirmed-shelf-triage.md
  sv: { keywords: { shelf-triage 0.5, decision-with-grounds 0.3, residual-routing 0.2 },
        dominant: "The to_be_confirmed shelf is triaged into decisions with grounds, not into silence." }
```

## SVM — the manifests of what is IN FLIGHT

Per-task manifests, YAML. `eta_turns` is the approximate number of turns until that plan moves to
`plans_completed/`. `state`: doing | blocked | verified | waiting-on-user.

```yaml
- task: S4
  plan: plans/2026-09-29_svm-tool-and-master-plan.md
  sv:
    keywords: { master-plan-render: 0.4, sv-mandatory-per-entry: 0.3, derived-not-written: 0.2, stable-rerun: 0.1 }
    dominant: render regenerates this file from the plan files and the store, with an SV for every plan, task and link — a missing one prints as MISSING
  eta_turns: 3
  state: doing
  oracle: two renders in a row are byte-identical, and no rendered plan or task lacks its sv (asserted, not eyeballed)

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

**How this file is produced until `svm render` exists, and what the renderer must satisfy when it lands.**
Until S4 ships, this file is written BY HAND from the two sources it names — the plan files (what exists and
what passed) and the SVM store (direction and distance) — and every entry that cannot be filled from them
says so instead of being invented. The contract the renderer must meet is NOT a new one: it is
`plans/2026-09-29_svm-tool-and-master-plan.md` → task **S4**, which carries its acceptance (two renders in a
row byte-identical; **no rendered plan, task or link without its sv**). An agent that opens this file before
that task is done reads S4 before regenerating anything by hand.

**Measured 2026-09-30 on an outside reader** (no frame, no tools, no session — `aicall`,
`space-bunny-free`, brief and reply in `experiments/2026-09-30_masterplan-gravity/`): given only the repo
root listing and this file, it named this file third — «next as a **state router**, not as an implementation
specification» — reproduced this file's own precedence rule («the plan file wins»), and named S4 as the next
action **with its oracle** («run `svm render` twice … correct only if the snapshots are byte-identical and
the renderer's assertion reports no missing SV»). Then it named the one thing missing: the handoff permitted
«until that lands» without saying what would run it. The paragraph above is the answer to it — the check the
owner asked for («any agent picks this up on autopilot») is the same check that finds the hole.

## Standing rules that outlive any plan

- Instrument before claim: no `[x]` without a run id, a hash or a rehearsal log.
- A refutation is a result, not a detour — C3 above was retired by one measurement.
- Absence of an oracle reads as FALSE to the user; a status surface renders a value, never nothing.
- Nothing under `bin/`; a render claim needs a rebuilt candidate.
- Memory carries only what has no other home — this file is one of those homes now.
