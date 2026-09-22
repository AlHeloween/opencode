# `core_schemas.yaml` — the kernel's data contract before the map-first cutover

Recovered 2026-09-22 from `f22f3ca337` (its last revision) because the owner asked where it
went: *«был yaml контракт где описывались планы, семантика и зависимости от них — где он
сейчас»*. It is kept here so the answer is a file and not a git command.

## The file

`prompts_kernel/core_schemas.yaml` — 606 lines, 32 top-level sections, added in `c430fe82d8`
(2026-08-06) as *"single source of truth with `@schema:` build-time injection"*. The kernel
fragments referenced `@schema:section_name` and the build resolved them, so the model saw full
schemas while a human edited ONE file.

Sections: `gates`, `sv_output`, `sv_target`, `sv_trajectory`, `semantic_control`,
`clean_next_state`, `blocker`, `task_statuses`, `action_class`, `execution_envelope`, `stamps`,
`claim_ledger`, `outcome_contract`, `risk_ledger`, `quality_metric_spec`, `quality_guardrails`,
`migration_protocol`, `capability_graph`, `intent_projection`, `project_geometry`,
`quality_vector`, `evolution_candidates`, `evolution_cycle`, `master_plan`, `fractal_geometry`,
`smoke_contract`, `msg_tag`, `signal_cluster`, `bug_fix`, `explorer_goal`, `domain_sources`.

## Where it went

Deleted by `45a6671dcd` (2026-09-02), *"kernel: cut over to map-first prompt_kernel"*. The YAML
plus its `@schema:` injection was replaced by a Python kernel — **`prompt_kernel/source.py`** —
whose rendered output is installed to
`packages/opencode/src/session/prompt/reasoning_prompt.txt` by `python -m prompt_kernel --install`
and embedded into the binary as a BunFS asset.

| old section | lives today as |
|---|---|
| `gates` | the `GATE(...)` definitions in `prompt_kernel/source.py` (G1 GROUND … G9 CLEAN_STATE) |
| `master_plan`, `claim_ledger`, `risk_ledger`, `outcome_contract`, `execution_envelope`, `smoke_contract`, `capability_graph`, `project_geometry`, `intent_projection`, `fractal_geometry`, `quality_vector`, `clean_next_state` | the kernel's `state_contract:` dictionary (`MASTER_PLAN: {plan_id, revision, state, premises, tasks, dependencies, rollback}` at `source.py:464`) |
| `sv_output`, `sv_target`, `sv_trajectory`, `semantic_control` | the `SEMANTIC_ATTENTION` protocol — rules `@SV_TARGET`, `@SV_TRAJECTORY`, `@SEMANTIC_CONTROL` (`source.py:288-292`) |
| `evolution_candidates`, `evolution_cycle`, `quality_guardrails`, `migration_protocol` | the `EVOLUTION_LOOP` protocol in the same file |
| `action_class(s)` | `action_classes` (`source.py:484`) |
| `master_plan.goals[].tasks[]` — `sv`, `done_pct`, `attempts`, `last_failure`, `status: [ ]/[x]` | **the plan files themselves**: `plans/*.md` tasks parsed by `packages/opencode/src/util/plan-status.ts` (`parseTaskTags`, `collectPlanState`) |
| `master_plan.state` enum (DRAFT…INVALIDATED) | `KERNEL_LIFECYCLE` in the same file (`plan-status.ts:214-222`) |
| `domain_sources` | `@SOURCE_ROUTING` (+ `@DOMAIN_SOURCES` alias) in the kernel |

## What was deliberately NOT migrated

`sv_trajectory`'s drift classification and its thresholds (`D_g < 0.3`, `stable_drift ≥ 2 turns`),
`semantic_control`'s PID terms and `‖R‖₁ < 0.15`, `fractal_geometry`'s adaptive `τ`/`k`/`depth`
formulas, `task_statuses` transitions, `blocker`, `msg_tag`, `signal_cluster`, `bug_fix`,
`explorer_goal`, `master_plan.lineage`.

The drift thresholds are the interesting case: they were not merely dropped, they were later
**measured and rejected** — on 2026-09-22 ΔSV on the written terms turned out saturated (neighbours
share no term at all, L1 median 2.0 of 2.0) and on embeddings consecutive pairs separate from
strangers by only 13 %, so no threshold is defensible and ΔSV stays an offline rank, never a fold
gate. What survives in the kernel is exactly that conclusion, compressed to one rule: retune
`@SV_TARGET` only around enough Exact medoids.

Probes and numbers: `experiments_history/2026-09-22_sv-attempts/`.
