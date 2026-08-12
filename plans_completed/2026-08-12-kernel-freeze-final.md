# Kernel Freeze — Final Consistency Fixes

**Description**: 6 minor ABI/routing fixes. No new concepts. Freeze candidate.

**Date**: 2026-08-12

## Fixes

| # | P | Что | Файлы |
|---|------|------|-------|
| 1 | P0 | Wire INTENT_PROJECTION to GATE_1: rules += [@PROJECT_GEOMETRY, @CAPABILITY_GRAPH, @INTENT_PROJECTION, @OUTCOME_CONTRACT] | `01_gates.txt` |
| 2 | P0 | GATE_2: input = INTENT_PROJECTION.residual.execution_goal (not raw Goal) | `01_gates.txt` |
| 3 | P1 | MASTER_PLAN.COMPLETED: use configurable threshold, not hardcoded 1.0 | `core_schemas.yaml` |
| 4 | P1 | QUALITY_VECTOR.invariant → see @QUALITY_GUARDRAILS | `core_schemas.yaml` |
| 5 | P1 | MIGRATION routing note in CLASSIFICATION | `00c_algorithms.txt` |
| 6 | P2 | Unify evidence_stamp/direct_evidence_stamp + ORCHESTRATOR ACL | `core_schemas.yaml` + `20_specs_agents.py` |
