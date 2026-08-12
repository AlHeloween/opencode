# Kernel Completion — Round 3 Fixes + Evolution Cycle

**Description**: Two-phase completion: (8) resolve 7 round-3 systemic issues, (9) add autonomous evolution outer loop.

**Date**: 2026-08-12

## Phase 8: Round 3 Systemic Fixes (7 issues)

### P0-8.1: Closure dead-end — separate execution_exhausted from terminal

**Problem**: `terminal=true` when `pending=[] AND active=[]`. But CLOSURE_PROOF may still be PENDING. Result: GATE_9 says terminal→next=none→hard stop, but closure not proven → dead-end.

**Fix**: Split into `execution_exhausted` (tasks done) and `terminal` (outcome decided). Add `CONTINUE` path when exhausted but closure pending.

| # | Task | Files |
|---|------|-------|
| 8.1a | Add `execution_exhausted` field to clean_next_state: `bool — pending=[] AND active=[]` | `core_schemas.yaml` |
| 8.1b | Redefine `terminal`: `enum SUCCESS | BLOCKED | OUT_OF_SCOPE` (not bool) | `core_schemas.yaml` |
| 8.1c | Add CONTINUE path: exhausted ∧ ¬closure → generate closure residual, next=derived from closure gaps | `reasoning/01_gates.txt` GATE_9 |

### P0-8.2: Canonical @OUTCOME_CONTRACT

**Problem**: CLOSURE_PROOF references `acceptance_coverage` and `outcome_oracle` but no canonical OUTCOME_CONTRACT schema defines what acceptance criteria ARE.

**Fix**: Add OUTCOME_CONTRACT schema — the WHY layer: what must be true for the goal to be satisfied.

| # | Task | Files |
|---|------|-------|
| 8.2a | Add `outcome_contract` schema: acceptance_criteria (list of oracle specs), coverage_threshold, critical_risks | `core_schemas.yaml` |
| 8.2b | Add `# @schema: outcome_contract` marker | `reasoning/00b_schemas.txt` |

### P0-8.3: Plan reauthorization split

**Problem**: `INVALIDATED → re-authorization` vs `PLAN_REVISION → re-authorize only if scope changed`. Ambiguous.

**Fix**: Split: `plan_reauthorization` = ALWAYS after INVALIDATED. `envelope_reissue` = only if scope/budget/baseline changed.

| # | Task | Files |
|---|------|-------|
| 8.3a | Update MASTER_PLAN.lifecycle.INVALIDATED: "plan_reauthorization ALWAYS; envelope_reissue if scope/budget changed" | `core_schemas.yaml` |
| 8.3b | Update PLAN_REVISION rule text to match split | `27_runtime_dict.py` |

### P1-8.4: RISK_LEDGER — replace structurally-zero metric

**Problem**: `critical_open_risks` counts Hypothetical/Unknown premises → structurally zero (enforcement blocks them). Metric never fires.

**Fix**: Replace with RISK_LEDGER tracking real residual risks: unresolved_external_dependency, unverified_acceptance_criterion, unresolved_safety_risk, failed_nonblocking_oracle.

| # | Task | Files |
|---|------|-------|
| 8.4a | Add `risk_ledger` schema with risk types | `core_schemas.yaml` |
| 8.4b | Update closure_proof.critical_open_risks → reference RISK_LEDGER | `core_schemas.yaml` |
| 8.4c | Add `# @schema: risk_ledger` marker | `reasoning/00b_schemas.txt` |

### P1-8.5: MASTER_PLAN lifecycle — IMPLEMENTED state

**Problem**: COMPLETED = tasks done + oracles PASS, but outcome may not be proven. Gap between local completion and outcome proof.

**Fix**: Add IMPLEMENTED between VERIFYING and COMPLETED. COMPLETED now requires CLOSURE_PROOF.

| # | Task | Files |
|---|------|-------|
| 8.5a | Add IMPLEMENTED to lifecycle: "all tasks done + oracles PASS; awaiting outcome proof" | `core_schemas.yaml` |
| 8.5b | Update lifecycle flow: DRAFT→ACTIVE→EXECUTING→VERIFYING→IMPLEMENTED→COMPLETED | `core_schemas.yaml` |

### P1-8.6: ACL contradictions in agent specs

**Problem**: PLAN_MODE: @WRITE_SCOPE in both invariants and forbidden. ORCHESTRATOR_AGENT: @SMOKE_BEFORE duplicated. Self-contradictory.

**Fix**: Clean up. PLAN_MODE: @WRITE_SCOPE stays in forbidden (plans_only_writes=true is the constraint). ORCHESTRATOR: deduplicate.

| # | Task | Files |
|---|------|-------|
| 8.6a | Fix PLAN_MODE: keep @WRITE_SCOPE only in forbidden, not invariants | `20_specs_agents.py` |
| 8.6b | Fix ORCHESTRATOR_AGENT: deduplicate @SMOKE_BEFORE, clarify forbidden semantics | `20_specs_agents.py` |

### P1-8.7: GATE_4 orchestrator identity

**Problem**: orchestrator_agent added to GATE_3 but GATE_4_AUTHORIZE.identity = [build_mode, plan_mode] only.

**Fix**: orchestrator delegates authorization to active primary. Add explicit `handoff_to_active_primary` note.

| # | Task | Files |
|---|------|-------|
| 8.7 | Add note to GATE_4: orchestrator_agent delegates authorization to active primary | `reasoning/01_gates.txt` |

---

## Phase 9: Autonomous Evolution Outer Loop

### P0-9.1: @PROJECT_GEOMETRY

**Purpose**: Define stable project structure that evolution must preserve. Prevents architectural vandalism.

Schema: components, dependency_graph, public_interfaces, stable_boundaries, stable_lanes, experimental_lanes, invariants (allowed_deps, forbidden_deps, protected_interfaces).

| # | Task | Files |
|---|------|-------|
| 9.1a | Add `project_geometry` schema | `core_schemas.yaml` |
| 9.1b | Add `# @schema: project_geometry` (reference-only, human-maintained) | `reasoning/00b_schemas.txt` |

### P0-9.2: @QUALITY_VECTOR

**Purpose**: 10-axis measurable project quality profile. Default weights: correctness 0.16, stability 0.14, performance 0.12, usability 0.12, automation 0.10, maintainability 0.12, architecture 0.10, documentation 0.06, observability 0.04, security 0.04.

| # | Task | Files |
|---|------|-------|
| 9.2a | Add `quality_vector` schema with axes + weights + metrics per axis | `core_schemas.yaml` |
| 9.2b | Add `# @schema: quality_vector` marker | `reasoning/00b_schemas.txt` |

### P1-9.3: @EVOLUTION_CANDIDATES

**Purpose**: After SUCCESS, compute quality deficit → 4 semantic peaks → generate 4 focused candidates + 1 cross-axis candidate via existing fractal geometry.

| # | Task | Files |
|---|------|-------|
| 9.3a | Add `evolution_candidates` schema: generation (fractal_geometry), validation (hard guardrails), fitness function | `core_schemas.yaml` |
| 9.3b | Add section to `00c_algorithms.txt`: candidate generation using existing @FRACTAL_GEOMETRY | `reasoning/00c_algorithms.txt` |

### P1-9.4: @EVOLUTION_CYCLE

**Purpose**: Full outer loop: SUCCESS → snapshot → quality analysis → 5 candidates → Pareto + fitness → select → NEW_GOAL → full G1..G9. Includes saturation criterion.

| # | Task | Files |
|---|------|-------|
| 9.4a | Add `evolution_cycle` schema: trigger, baseline, analysis, candidate_generation, selection, saturation | `core_schemas.yaml` |
| 9.4b | Add `# @schema: evolution_cycle` marker | `reasoning/00b_schemas.txt` |

---

## Verification

1. `python -m pytest prompts_kernel/tests/ -q` — 490 passed
2. Explorer agent: verify all 7 round-3 issues resolved + 4 evolution anchors present
3. Manual: check OUTCOME_CONTRACT anchors before CLOSURE_PROOF references

## Claim Ledger

| ID | Text | Status |
|----|------|--------|
| C1-C12 | Previous premises | Exact |
| C13 | Closure dead-end exists | Exact (from analysis) |
| C14 | OUTCOME_CONTRACT missing | Exact |
| C15 | Plan reauthorization ambiguous | Exact |
| C16 | critical_open_risks structurally zero | Exact |
| C17 | COMPLETED before outcome proven | Exact |
| C18 | ACL contradictions in agent specs | Exact |
| C19 | GATE_4 missing orchestrator | Exact |
