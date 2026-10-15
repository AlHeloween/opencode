# Kernel reward

Canonical definition — `REWARD_FUNCTION` in `prompt_kernel/source.py`.
It ships in each of the four variants: OpenCode, Claude, Cursor and Codex.

The historical basis of `R` is the weighted mean of measured components with
weights `[0.35, 0.20, 0.25, 0.15]`: semantic-vector closeness, relative
measured FLOPs, the share of pinned Exact medoids, and the share of stamped
claims. `0.05·critical_risks_open` is subtracted. Available components are
renormalized; undefined components are omitted. With no measured components
the result stays `Unknown`. FLOPs must never be substituted with a token count.

Owner addition of 2026-10-15 (revision 3, corrections 1-2: portfolio-wide, reward split from penalty):

```text
R += plans_completed / (101 − pct)^2
R −= 0.05 · plans_abandoned
pct = 100 · plans_completed / (plans_completed + plans_in_progress)
```

`plans_completed` counts plans whose acceptance (their intention → to_state) is
oracle-confirmed — ticked boxes alone do not complete a plan. `plans_in_progress`
counts open plans whose open tasks carry a next action and a continuation
receipt (the G9 rule that already requires them). `plans_abandoned` counts open
plans with an open task lacking either. A plan in `plans/postponed/` with its
owner decision and resume condition counts in neither term: waiting on the
owner is not the agent's fault. The penalty reuses the SAME weight as an open
critical risk — no new constant — and vanishes the moment the plan is finished,
continued with a receipt, or moved by its outcome. An undefined term is omitted.

The term exists so plans are finished, not opened and dropped. Abandoned plans
do NOT enter `pct`: with them inside the denominator (the rejected correction-1
form), 9 of 10 completed plus 10 dumped plans would collapse the term from
9/121 ≈ 0.074 to 9/3136 ≈ 0.003 — about 26× — punishing honest work in progress
as hard as the dump. The split keeps the owner's curve on completed +
in-progress plans and prices abandonment linearly instead.

Three cases (10 plans in scope, 9 completed + 1 in progress):

| case | completed | in progress | abandoned | pct | completion | penalty | net |
|------|-----------|-------------|-----------|-----|------------|---------|-----|
| 1 | 9 | 1 | 0 | 90 | 9/121 ≈ 0.0744 | 0 | +0.0744 |
| 2 | 9 | 1 | 10 | 90 | 9/121 ≈ 0.0744 | −0.5 | −0.4256 |
| 3 | 9 | 11 | 0 | 45 | 9/3136 ≈ 0.0029 | 0 | +0.0029 |

Case 2 is the dump: the completion curve is untouched (abandoned plans are not
in `pct`), the linear penalty prices it at −0.5. Case 3 is the recovery: the 10
plans continued with receipts — the penalty vanishes, and the term reflects the
larger in-progress portfolio.

For `delta_R` comparison the measured terms, baseline and scope are frozen.
The reward stays advisory telemetry: it grants no action authority. An
uncontained critical risk forbids execution regardless of the score; a
refutation stays progress even when `R` falls.

This is the definition inside the system prompt. No separate runtime numeric
calculator is added by this change. The existing BooleanPredicate checks the
final `reward > 0` and `loop_progress_holds`.

Checks: `prompt_kernel/tests/test_reward_restoration.py` preserves the exact
historical literal, verifies the addition and all render variants. Mutation
controls remove individual material parts to prove the oracle can tell a lost
contract clause, and reject the measured failure shapes: a per-plan
percentage, abandoned plans inside `pct`, a total that excludes open plans, a
penalty weight off the critical-risk weight, and postponed plans counted.
Persistent readback compares the four real receivers with the
canonical render byte for byte.

The installed prefix changes through the standard pipeline. An open session
keeps its frozen prefix until the usual refresh boundary. The evidence and the
change bounds live in the
[restoration plan](../plans_completed/2026-10-15_restore-reward-formula.md).

```yaml
Keywords: reward-contract 0.50, portfolio-completion 0.30, abandoned-penalty 0.20
Semantic dominant: The reward pays the portfolio completion curve and prices abandoned plans linearly; postponed plans count in neither term.
md5: 3a7c19e5b8d24f6091c4e7a2d5b8f3c6
prev-md5: 19b9d98fe3644c39a17c6a9b63bce884
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
