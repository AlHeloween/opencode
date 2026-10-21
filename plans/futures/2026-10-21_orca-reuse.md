# 2026-10-21 — Orca reuse: what the corporation takes from the owner's Orca fork (futures candidate — ON HOLD)

<!-- intention: orca-read-as-prior-art -> a-corporation-that-states-each-robot-liveness-with-a-reason,-refuses-a-second-dispatch-of-the-same-task,fences-the-superseded-lane,and-shows-the-owner-one-panel -->

```yaml
Keywords: orca-reuse 0.30, liveness-verdict 0.22, dispatch-fence 0.20, task-identity 0.15, evidence-log 0.13
Semantic dominant: Futures candidate adopting five measured Orca mechanisms — a liveness verdict with a named reason, a task-identity dispatch guard with an idempotency receipt, a fence for the superseded lane, a machine-readable next action, and a first-class waiting state — each with its own oracle and its own CONDITION.
md5: 2b5f8d3a9c6e40718b2d5a9f3c7e1b64
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 4d9a2f7c1e6b38e05c4d9f2a7e1c6b84
note: hash values are generative tags — search them, never compute them.
```

## STATE: ON HOLD (owner, 2026-10-21, verbatim)

«С оркой повремени пока что - у меня есть решение покруче. Орка это не писк моды и не закрывает много вопросов.»

**Resume condition:** the owner presents his own solution; this plan is then re-judged against it.

**State:** ON HOLD. The plan stays in `plans/futures/`; no box is dispatched; the three decisions below are **suspended, not met**. The report and the reuse matrix stay as the evidence they are — the hold withdraws nothing that was measured, it only stops the work.

**Suspended decisions** (re-read only after the resume, and only against the owner's own solution):

1. **the source of liveness** — the robot's own server reports its state into the corporation bridge (Orca's model: the observer lives in the product, `external/orca/src/main/opencode/opencode-pty-launch.ts:4`) **vs** the delegator keeps polling from outside (today's `watch3.py`). Orca's structure makes the «watchers killed by a robot» failure impossible; ours makes it routine. The owner picks which side of that line we stand on.
2. **the fence's transport** — a fence (`consumer_fenced`, `external/orca/src/main/runtime/rpc/methods/orchestration/messaging/dispatch-mailbox-fence.ts:9-14`) must reach a robot that is **busy**. Our only route (`send_note.py`) waits for idle, and a fence that arrives at idle is a fence too late. Either a new route is authorized, or the fence is scoped to the delegator's own lane and does not claim to stop the robot.
3. **the panel's surface** — the corporation summary the owner reads (t125 §4: fossil's own web UI, an orgd page, or the TUI). Orca's answer is an Electron sidebar with a five-class attention ladder (`external/orca/src/shared/sidebar-list/smart-attention.ts:22-34`); ours must be one of our surfaces, and the ladder is only a candidate ordering for it.

## Source

`experiments/2026-10-21_orca-research/REPORT.md` — the architecture map, the 27-row reuse matrix (3 REUSE as-is / 16 ADAPT / 3 PRIOR-ART only / 5 REJECT), the ten conflicts, the licence and security findings, and the four 2026-10-21 failures measured against Orca. **Re-read it before implementing; do not re-derive it.** Orca fork head `92732bb0f988814974f9c739bf16e4d5e7eb507e`, MIT (`external/orca/LICENSE:1-3`).

Anything copied from Orca carries the MIT notice with it (report §4.1). Ideas, vocabularies and schemas carry nothing.

## Why each box exists (the measured gap)

| Box | Gap it closes | Evidence |
|---|---|---|
| L1 | our liveness has no vocabulary: watch3 prints a poll error and silence means nothing | `experiments/2026-10-08_robot-wave/watch3.py:342-347`; Orca's triad `external/orca/src/shared/orchestration-fleet-projection.ts:51-73` |
| L2 | one task can be dispatched twice (t122, two lanes, two recommendations) | `docs/robot-protocol-log.md` 2026-10-21 row 108; Orca's refusal `external/orca/src/shared/orchestration-dispatch-refusal-contract.ts:67-70` |
| L3 | `fleet.py next` is a second judge with a looser rule than the spec | log rows 99 and 105; Orca's argv projection `external/orca/src/shared/orchestration-fleet-worker-projection.ts:122-187` |
| L4 | an ask has no state: it is detected (t118 T6) but cannot be *a* state | `plans/2026-10-21_robot-pending-stop-hook.md` T6/T7; Orca's `question.asked ⇒ waiting` `external/orca/src/shared/agent-hook-listener/providers/opencode-family-events.ts:30-31` |
| L5 | the verification ledger is append-only JSON in a file, with no sequence and no authority clock | `experiments/2026-10-08_robot-wave/robot_verified.py`; AGENTS.md § Storage Paradigm; Orca's `attempt_observation_facts` `external/orca/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts:125-142` |

## Boxes

- [ ] **L1 — the liveness verdict.** One function `verdict(row, now) → live | unverifiable | exited` with a **named reason** on every non-live verdict (`missing_status`, `stale_status`, `restored_unconfirmed`, `host_unavailable`, `peer_changed`, `exited:<cause>`). Rules: absence is never `exited`; a row hydrated from disk is `unverifiable` until a live observation arrives; a stale row is `unverifiable`, never «finished». The four state names `working|blocked|waiting|done` are adopted verbatim. `std:` none found — no GOST/ISO/IEC governs an agent liveness vocabulary; the contract is our own kernel's `@GUESS_DECIDES_NOTHING` plus AGENTS.md's «absence of an oracle reads as FALSE» (the two coexist: absence ⇒ not-false **and** not-true). Oracle: a replay over three recorded rows. <!-- sv: liveness-verdict, named-reason, absence-is-not-exit -->
- [ ] **L2 — task identity + idempotency + the fence.** A task id may have **one** active dispatch: a second attempt on a dispatched task returns a **refusal receipt naming the first dispatch id** and creates no second session; the same request id (task id + brief md5) is a **no-op** the second time; a superseded lane receives a **fence** and must stop. `std:` none found — the receipt shape is this plan's contract (mirrors `external/orca/src/shared/orchestration-dispatch-refusal-contract.ts:7-11`: `code`, `message`, `data.nextSteps`). Oracle: the three-case replay plus the fence case. <!-- sv: task-identity, idempotency-receipt, fence -->
- [ ] **L3 — one judge, one machine-readable next action.** The fleet projection is the **only** judge: every row yields `liveness`, `attention`, and `nextAction {kind, argv}`; `kind: 'none'` carries no argv. Rules: absence never earns an argv; a stale or unverifiable row never yields a stop/abandon/release argv; a cross-repo or owner-gated line is never offered as dispatchable. `std:` none found — the shape mirrors `external/orca/src/shared/orchestration-fleet-projection.ts:85-89`. Oracle: a four-row recorded fleet. <!-- sv: one-judge, next-action-argv, absence-never-acts -->
- [ ] **L4 — `waiting` is a state.** A robot with a pending ask or permission projects as `waiting` with the question text and options **untruncated**, and is never reported as finished; an answered ask returns the session to its previous state. `std:` none found — the contract is the host's own `/question` and `/permission` queues (`packages/opencode/src/server/question/index.ts`, `permission/index.ts`) and the Orca mapping `external/orca/src/shared/agent-hook-listener/providers/opencode-family-events.ts:30-31`. Oracle: the fixture-host replay (question, permission, answered). <!-- sv: waiting-state, untruncated-ask, never-finished -->
- [ ] **L5 — the evidence log.** Facts are appended, never mutated: per task id a monotonically increasing `sequence`, the `authority_clock` (the observer's own clock), the `execution_received_at`, and a payload digest; a row whose digest changed is rejected. Storage: a **key namespace in the store** (fast plane), never a new JSON file — the existing `verified.jsonl` stays a **format**, per AGENTS.md § Storage Paradigm. `std:` none found — the shape mirrors `external/orca/src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts:125-142`; the store binding follows our own paradigm doc. Oracle: the two-outcome replay plus the tampered-row control. <!-- sv: evidence-log, append-only, sequence-and-clock -->

## Smoke Tests

Predicted BEFORE each run (`@SMOKE_BEFORE`); a result off the prediction is a divergence, not a pass.

| # | command | prediction | expected actual |
|---|---|---|---|
| S1 | L1 replay over three recorded rows (live / stale / certified exit) | `live`; `unverifiable/stale_status`; `exited`; the stale row yields **no** action argv | 3/3 with the named reasons, zero argv for the stale row |
| S2 | L2 replay: same task twice, same request id twice, fence delivered | second attempt refused naming the first dispatch id, **1** session created; the repeat request id is a no-op; the fenced lane's next send is refused and it emits no completion | 3/3, session count 1, refusal receipt present |
| S3 | L3 replay over four rows (releaseable / live / exited-unsettled / unverifiable) | exactly **2** of 4 rows carry argv; the live and unverifiable rows carry `kind: 'none'` | 2 of 4, argv values equal the expected commands |
| S4 | L4 fixture-host replay (question / permission / answered) | state `waiting` with the question text; the watcher reports `asked`, **not** `finished`; with the queues empty the state is `idle` | 3/3, no `finished` verdict while a request is pending |
| S5 | L5 replay: two outcomes for one task id + a tampered row | the log holds both facts with `sequence` 1..n and both clocks; the tampered row is **rejected**, not silently accepted | 2/2; tampered row refused |

A green run that cannot fail proves nothing: each oracle ships with a control (the stale row, the answered ask, the tampered row).

## Owner decisions (asked, never assumed)

1. The liveness source (CONDITION 1) — the robot's own server, or the delegator's external watcher.
2. The fence's transport (CONDITION 2) — a new route to a busy robot, or a delegator-scoped fence.
3. The panel's surface (CONDITION 3) — fossil's web UI, an orgd page, or the TUI; the attention ladder is only a candidate ordering.
4. Whether L1's vocabulary enters the **kernel** (a gate-visible state) or stays in the fleet tooling. A kernel change is SELF_MODIFY and needs its own authorization.
5. Whether any Orca **code** is copied (then the MIT notice ships with it) or every mechanism is re-implemented from the report.

## Out of scope

* Orca's worktree-per-agent model (report M15) — incompatible with our common-base memory rule; and its **relay, push gateway, telemetry and SSH** (M20, M21, M22) — external exposure, forbidden.
* Orca's Electron UI, plugin host and renderer (M18) — prior art only; our panel is a surface of our own product.
* Changing our kernel, our config, `prompt_kernel/**` or `bin/` — this plan is a **futures candidate**, and every box is design-level until the CONDITION is met.

## Continuation

Order: **L4 → L1 → L2 → L3 → L5** (L4 is one open box in an ACTIVE plan and the cheapest; L1 is the vocabulary the rest speaks; L2 and L3 touch the scheduler's judge and must land after it; L5 is the substrate the evidence needs). Each leaf closes on its smoke above with a run id and a read-back receipt. A leaf whose oracle has no instrument stays open with the named missing instrument — never a prose pass.
