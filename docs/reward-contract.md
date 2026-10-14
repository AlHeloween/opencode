# Kernel reward

Canonical definition — `REWARD_FUNCTION` in `prompt_kernel/source.py`.
It ships in each of the four variants: OpenCode, Claude, Cursor and Codex.

The historical basis of `R` is the weighted mean of measured components with
weights `[0.35, 0.20, 0.25, 0.15]`: semantic-vector closeness, relative
measured FLOPs, the share of pinned Exact medoids, and the share of stamped
claims. `0.05·critical_risks_open` is subtracted. Available components are
renormalized; undefined components are omitted. With no measured components
the result stays `Unknown`. FLOPs must never be substituted with a token count.

Owner addition of 2026-10-15 (revision 2, the unit is a PLAN):

```text
R += plan_done_sum / (101 − plan_done_percent)^2
plan_done_percent = 100 · completed_plans / total_plans
```

`plan_done_sum` is the sum over completed plans: every plan with an
oracle-confirmed completion contributes 1, in the same frozen scope. An
undefined term is omitted. At 99% the denominator is 4, at 100% — 1: the
formula strengthens the reward for carrying the plan portfolio to the end.

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
contract clause. Persistent readback compares the four real receivers with the
canonical render byte for byte.

The installed prefix changes through the standard pipeline. An open session
keeps its frozen prefix until the usual refresh boundary. The evidence and the
change bounds live in the
[restoration plan](../plans_completed/2026-10-15_restore-reward-formula.md).

```yaml
Keywords: reward-contract 0.50, task-completion 0.35, measured-evidence 0.15
Semantic dominant: The reward keeps measured progress and strengthens oracle-confirmed plan completion.
md5: 19b9d98fe3644c39a17c6a9b63bce884
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
