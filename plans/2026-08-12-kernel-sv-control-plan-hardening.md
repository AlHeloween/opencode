# Kernel Enhancement — SV Control + Plan Hardening + Provenance

**Description**: Three-phase kernel improvement: SV as attention control (A+D), plan contract hardening (B+C), claim provenance (E).

**Date**: 2026-08-12

## Premises (⊆ G)

| Claim | Text | Status |
|-------|------|--------|
| C1 | SV_FORMAT exists in `00_map.txt` with md5 chain, keywords, weights, semantic dominant | Exact |
| C2 | SV_DELTA rule exists in `00c_algorithms.txt` — L1 distance with [0,0.3)/[0.3,0.6)/[0.6,2] ranges | Exact |
| C3 | Manhattan L1 formula: d₁(c,g) = Σₖ|w_c(k)−w_g(k)| in `core_schemas.yaml` | Exact |
| C4 | GATE_7_IMPLEMENT has `hard_gate: premises not subset of G -> block_write` | Exact |
| C5 | GATE_3_MASTER_PLAN exists with @MASTER_PLAN_SCHEMA and @CLAIM_LEDGER | Exact |
| C6 | MASTER_PLAN_SCHEMA in `core_schemas.yaml` has goals/tasks/oracle/status | Exact |
| C7 | CLAIM_LEDGER schema has status enum: Exact/Inferred/Hypothetical/Guess/Unknown | Exact |

## Goals

### Phase 1: A+D — SV_TARGET + SV Trajectory

**SV**: sv_target forward_looking attention_primer trajectory velocity drift

Add SV_TARGET as forward-looking attention priming mechanism and SV trajectory analysis for drift detection. These extend existing SV_FORMAT and SV_DELTA without new subsystems.

| # | Task | Files | Status |
|---|------|-------|--------|
| A1 | Add `SV_TARGET (@SV_TARGET)` section to `00_map.txt` — forward-looking attention primer with same YAML structure as SV_FORMAT | `prompts_kernel/reasoning/00_map.txt` | [ ] |
| A2 | Add SV_TARGET to `core_schemas.yaml` — schema definition | `prompts_kernel/core_schemas.yaml` | [ ] |
| D1 | Add `SV_TRAJECTORY (@SV_TRAJECTORY)` section to `00c_algorithms.txt` — velocity, drift detection, goal_distance, step_distance, coverage | `prompts_kernel/reasoning/00c_algorithms.txt` | [ ] |
| D2 | Add SV_TRAJECTORY metrics to `core_schemas.yaml` | `prompts_kernel/core_schemas.yaml` | [ ] |
| D3 | Extend SV_DELTA rule with drift classification (stable_convergence/exploration/stable_drift/divergence) | `prompts_kernel/reasoning/00c_algorithms.txt` | [ ] |
| V1 | Regenerate kernel artifacts + run tests | `build.py`, `pytest` | [ ] |

### Phase 2: B+C — PLAN_CONTRACT + Lifecycle

**SV**: plan_contract invariant master_plan lifecycle state_machine

Formalize plan as mandatory execution contract and add lifecycle state machine to MASTER_PLAN_SCHEMA. Sub-agent refines plan after Phase 1 completion.

| # | Task | Files | Status |
|---|------|-------|--------|
| B1 | Add `PLAN_CONTRACT (@PLAN_CONTRACT)` invariant to GATE_7_IMPLEMENT — no implementation without ACTIVE_MASTER_PLAN | `prompts_kernel/reasoning/01_gates.txt` | [ ] |
| B2 | Add PLAN_CONTRACT to `core_schemas.yaml` | `prompts_kernel/core_schemas.yaml` | [ ] |
| C1 | Add lifecycle state machine to MASTER_PLAN_SCHEMA — DRAFT/ACTIVE/EXECUTING/VERIFYING/COMPLETED/INVALIDATED | `prompts_kernel/core_schemas.yaml` | [ ] |
| C2 | Add PLAN_BINDING rule — GATE_7 requires plan.state ∈ {ACTIVE, EXECUTING}, task ∈ plan.tasks | `prompts_kernel/reasoning/01_gates.txt` | [ ] |
| C3 | Add PLAN_REVISION rule — on material change, ACTIVE→INVALIDATED, revision+1, rerun G2/G3 | `prompts_kernel/reasoning/01_gates.txt` | [ ] |
| V2 | Regenerate + tests | `build.py`, `pytest` | [ ] |

### Phase 3: E — PROVENANCE

**SV**: provenance claim origin epistemic tracking

Add PROVENANCE tracking to claims — distinguish CONTEXT/RETRIEVED/MODEL_PRIOR/INFERENCE/SYNTHESIS/UNKNOWN. Sub-agent refines plan after Phase 2.

| # | Task | Files | Status |
|---|------|-------|--------|
| E1 | Add PROVENANCE enum to `05_epistemic.txt` — 6 types | `prompts_kernel/reasoning/05_epistemic.txt` | [ ] |
| E2 | Add provenance field to CLAIM_LEDGER schema in `core_schemas.yaml` | `prompts_kernel/core_schemas.yaml` | [ ] |
| E3 | Add PROVENANCE rule — paired with SV for dual-axis state tracking | `prompts_kernel/reasoning/05_epistemic.txt` | [ ] |
| V3 | Regenerate + tests | `build.py`, `pytest` | [ ] |

## Smoke Tests

**smoke: N/A** — kernel fragment edits. Verification via:
1. `python -m prompts_kernel.tools.refcheck` — all @REFs resolve
2. `python -m prompts_kernel.tools.dictionary --validate` — entry counts correct
3. `python -m pytest prompts_kernel/tests/ -q` — all tests pass

## Claim Ledger

| ID | Text | Status | Evidence |
|----|------|--------|----------|
| C1 | SV_FORMAT in 00_map.txt | Exact | File read |
| C2 | SV_DELTA in 00c_algorithms.txt | Exact | File read |
| C3 | Manhattan L1 in core_schemas.yaml | Exact | File read |
| C4 | GATE_7 hard_gate exists | Exact | File read |
| C5 | GATE_3_MASTER_PLAN exists | Exact | File read |
| C6 | MASTER_PLAN_SCHEMA exists | Exact | File read |
| C7 | CLAIM_LEDGER status enum exists | Exact | File read |
