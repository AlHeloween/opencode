# Kernel Completion — Round 4: Intent Projection + Consistency

**Description**: Round 4 ChatGPT review — 10 findings. P0: intent projection layer, stale rule sync, lifecycle gap. P1: evolution flow, quality normalization, migration protocol. P2: lineage, thresholds, ACL cleanup.

**Date**: 2026-08-12

## Premises

| Claim | Text | Status |
|-------|------|--------|
| C1-C19 | Previous premises | Exact |
| C20 | USER_REQUEST ≠ EXECUTION_GOAL — no intent projection | Exact |
| C21 | RESIDUAL_LOOP still says "empty → TERMINAL" | Exact |
| C22 | PLAN_LIFECYCLE rule text missing IMPLEMENTED | Exact |
| C23 | Evolution candidate → MASTER_PLAN directly (should be GOAL first) | Exact |
| C24 | QUALITY_VECTOR D_i = w_i(1-Q_i) but Q_i undefined | Exact |

## Phase 10: P0 — Intent Projection + Capability Graph

**SV**: intent_projection capability_graph delta_goal user_request

Core insight: `USER_REQUEST != EXECUTION_GOAL`. EXECUTION_GOAL = PROJECTED_RESIDUAL(USER_REQUEST, PROJECT_GEOMETRY, CAPABILITY_GRAPH). If ΔG=∅, don't implement — Oracle verifies existing capability.

| # | Task | Files |
|---|------|-------|
| 10.1 | Add `capability_graph` schema: nodes (existing capabilities), edges (relations), outcomes (user-visible), evidence (code/tests/docs) | `core_schemas.yaml` |
| 10.2 | Add `intent_projection` schema: observation, desired_outcome, suggested_solution, constraints, projection (matching_geometry, coverage), residual (delta_graph, execution_goal) | `core_schemas.yaml` |
| 10.3 | Add invariant: USER_REQUEST ≠ EXECUTION_GOAL. ΔG=∅ → Oracle verify, skip implementation | `core_schemas.yaml` |
| 10.4 | Add `# @schema: capability_graph`, `# @schema: intent_projection` markers | `reasoning/00b_schemas.txt` |

## Phase 11: P0 — Stale Rule Cleanup

**SV**: residual_loop closure_proof lifecycle stale_rules sync

| # | Task | Files |
|---|------|-------|
| 11.1 | Update RESIDUAL_LOOP rule: "pending empty → execution_exhausted; closure PASS → SUCCESS; closure gaps → CONTINUE with residual" | `27_runtime_dict.py` |
| 11.2 | Update CLOSURE_PROOF rule: "SUCCESS requires execution_exhausted=true AND acceptance_coverage ≥ outcome_contract.coverage_threshold AND critical_open_risks=0 AND outcome_oracle=PASS" | `27_runtime_dict.py` |
| 11.3 | Sync PLAN_LIFECYCLE rule text: add IMPLEMENTED between VERIFYING and COMPLETED | `27_runtime_dict.py` |
| 11.4 | Fix coverage_threshold: use outcome_contract.coverage_threshold (not hardcoded 1.0) in CLOSURE_PROOF schema | `core_schemas.yaml` |

## Phase 12: P1 — Evolution Flow + Quality Normalization

**SV**: evolution_goal quality_metric_spec normalization migration_protocol

| # | Task | Files |
|---|------|-------|
| 12.1 | Evolution: selected_candidate → NEW_GOAL (not MASTER_PLAN). GOAL then goes G1→G2→G3→MASTER_PLAN | `core_schemas.yaml` evolution_cycle |
| 12.2 | Add `quality_metric_spec` schema: id, unit, direction (MAXIMIZE/MINIMIZE/TARGET), baseline, target, hard_limit, normalize function, oracle, confidence | `core_schemas.yaml` |
| 12.3 | Add `quality_guardrails` anchor: hard-deny correctness_regression, stability_regression, security_regression. Reference from both QUALITY_VECTOR and EVOLUTION_CANDIDATES | `core_schemas.yaml` |
| 12.4 | Add `migration_protocol` schema: NORMAL_EVOLUTION vs ARCHITECTURE_EVOLUTION vs MIGRATION. Migration requires: explicit auth, isolated branch, full-project oracle, compatibility oracle, rollback proof | `core_schemas.yaml` |
| 12.5 | Add `# @schema:` markers for quality_metric_spec, quality_guardrails, migration_protocol | `reasoning/00b_schemas.txt` |

## Phase 13: P2 — Lineage + ACL Cleanup

**SV**: lineage parent_goal acl orchestrator cleanup

| # | Task | Files |
|---|------|-------|
| 13.1 | Add `lineage` to MASTER_PLAN_SCHEMA: parent_goal_id, generation_id, evolution_candidate_id, parent_project_snapshot | `core_schemas.yaml` |
| 13.2 | ACL: verify ORCHESTRATOR_AGENT — @WRITE_SCOPE in invariants vs forbidden. If still contradictory, fix | `20_specs_agents.py` |
| 13.3 | Add `# @schema:` markers for new schemas if needed | `reasoning/00b_schemas.txt` |

## Verification

1. `python -m pytest prompts_kernel/tests/ -q` — 490 passed
2. Explorer: verify no stale "pending empty → TERMINAL", IMPLEMENTED in lifecycle text, coverage_threshold used not hardcoded

## Claim Ledger

| ID | Text | Status |
|----|------|--------|
| C1-C19 | Previous | Exact |
| C20-C24 | Round 4 premises | Exact |
