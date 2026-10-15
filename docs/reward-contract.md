# Kernel reward

Canonical definition — `REWARD_FUNCTION` in `prompt_kernel/source.py`.
It ships in each of the four variants: OpenCode, Claude, Cursor and Codex.

The historical basis of `R` is the weighted mean of measured components with
weights `[0.35, 0.20, 0.25, 0.15]`: semantic-vector closeness, relative
measured FLOPs, the share of pinned Exact medoids, and the share of stamped
claims. `0.05·critical_risks_open` is subtracted. Available components are
renormalized; undefined components are omitted. With no measured components
the result stays `Unknown`. FLOPs must never be substituted with a token count.

Owner addition of 2026-10-15 (revision 4, B6 per Claude's review of a0e15e87b5):

```text
R += plans_completed / (101 − pct)^2
R −= 0.05 · plans_abandoned
pct = 100 · plans_completed / (plans_completed + plans_in_progress + plans_abandoned)
```

`plans_completed` counts plans whose acceptance (their intention → to_state) is
oracle-confirmed — ticked boxes alone do not complete a plan. `plans_in_progress`
counts open plans whose open tasks carry a next action and a continuation
receipt READ BACK from a result — a ticket, a dispatch or a run id; a one-line
«resuming later» note is not a receipt. `plans_abandoned` counts open plans with
an open task lacking either. Abandoned plans are IN the denominator: leaving
them out let abandoning an in-progress plan lift `pct` (9 completed + 1 in
progress → abandon the one: 9/(101−100)² − 0.05 = 8.95 — the exploit Claude's
review caught; the fixed form gives 0.0244). A plan in `plans/postponed/` with a
QUOTED owner decision and its resume condition counts in neither term — a vague
remark is not the decision, the same way OUT_OF_SCOPE needs the quoted
exclusion. The penalty reuses the SAME weight as an open critical risk — no new
constant — and vanishes the moment the plan is finished, is continued with such
a receipt, or is moved by its outcome. An undefined term is omitted.

Four cases (10 plans in scope, 9 completed):

| case | completed | in progress | abandoned | pct | completion | penalty | net |
|------|-----------|-------------|-----------|-----|------------|---------|-----|
| 1 baseline | 9 | 1 | 0 | 90 | 9/121 ≈ 0.0744 | 0 | +0.0744 |
| 2 abandon the one | 9 | 0 | 1 | 90 | 9/121 ≈ 0.0744 | −0.05 | +0.0244 |
| 3 dump +10 | 9 | 1 | 10 | 45 | 9/3136 ≈ 0.0029 | −0.5 | −0.4971 |
| 4 the 10 continued | 9 | 11 | 0 | 45 | 9/3136 ≈ 0.0029 | 0 | +0.0029 |

Case 2 is the abandon case: no gain from abandoning — `pct` holds at 90 because
abandoned plans are in the denominator, and the linear penalty prices the
abandonment. (Under the rejected pre-review form `pct` hit 100 and the term
exploded to 9 − 0.05 = 8.95.) Case 3 is the dump: the term drops AND the linear
penalty prices it. Case 4 is the recovery: the 10 plans continued with real
receipts — the penalty vanishes.

For `delta_R` comparison the measured terms, baseline and scope are frozen. The
reward stays advisory telemetry: it grants no action authority. An
uncontained critical risk forbids execution regardless of the score; a
refutation stays progress even when `R` falls.

This is the definition inside the system prompt. No separate runtime numeric
calculator is added by this change. The existing BooleanPredicate checks the
final `reward > 0` and `loop_progress_holds`.

Checks: `prompt_kernel/tests/test_reward_restoration.py` preserves the exact
historical literal, verifies the addition and all render variants. Mutation
controls remove individual material parts to prove the oracle can tell a lost
contract clause, and reject the measured failure shapes: a per-plan percentage,
a pct denominator WITHOUT `plans_abandoned` (the abandon-exploit), a receipt
not read back from a result, an unquoted owner decision, a total that excludes
open plans, a penalty weight off the critical-risk weight, and postponed plans
counted. Persistent readback compares the four real receivers with the
canonical render byte for byte.

The installed prefix changes through the standard pipeline. An open session
keeps its frozen prefix until the usual refresh boundary. The evidence and the
change bounds live in the
[restoration plan](../plans_completed/2026-10-15_restore-reward-formula.md).

```yaml
Keywords: reward-contract 0.50, portfolio-completion 0.30, abandoned-penalty 0.20
Semantic dominant: The reward pays the portfolio completion curve and prices abandoned plans linearly; postponed plans count in neither term.
md5: 71c4e0b9d2f85a3617c9e4b8d5a2f631
prev-md5: 3a7c19e5b8d24f6091c4e7a2d5b8f3c6
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
