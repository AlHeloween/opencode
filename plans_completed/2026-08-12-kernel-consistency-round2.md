# Kernel Consistency Fixes — ChatGPT Review Round 2

**Description**: Five fixes from second ChatGPT review: GATE_3 identity, CLOSURE_PROOF, SV_STATE definition, forward reference reorder, wording soften.

**Date**: 2026-08-12

## Premises (⊆ G)

| Claim | Text | Status |
|-------|------|--------|
| C1 | GATE_3_MASTER_PLAN identity: [plan_mode] only | Exact |
| C2 | BUILD_MODE includes @GATE_3_MASTER_PLAN in its gates | Exact |
| C3 | Terminal = pending=[] AND active=[] in clean_next_state | Exact |
| C4 | SV_STATE referenced in MULTI_AGENT_SV + SEMANTIC_CONTROL, no formal definition | Exact |
| C5 | SEMANTIC_CONTROL references @MULTI_AGENT_SV which is defined later (forward ref) | Exact |
| C6 | SV_TARGET wording: "primes attention heads" — mechanistic claim | Exact |

## Goals

### P0: GATE_3 Identity — allow build_mode to create plans

**SV**: gate_3 identity build_mode plan_creation

Build_mode must pass GATE_3 to reach GATE_7 (mandatory plan contract). But GATE_3 lists only plan_mode. Fix: add build_mode + orchestrator_agent.

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Change `identity: [plan_mode]` → `identity: [plan_mode, build_mode, orchestrator_agent]` | `reasoning/01_gates.txt:22` | [ ] |

### P0: CLOSURE_PROOF — outcome-based terminal semantics

**SV**: closure_proof terminal outcome coverage success

Terminal currently = "no pending tasks". Must evolve to "goal proven satisfied". Minimum: add CLOSURE_PROOF concept to clean_next_state, keep existing terminal as-is but add note.

| # | Task | Files | Status |
|---|------|-------|--------|
| 2 | Add `closure_proof` field to clean_next_state: acceptance_coverage, critical_open_risks, outcome_oracle | `core_schemas.yaml` clean_next_state | [ ] |
| 3 | Add @CLOSURE_PROOF reference to GATE_9 rules list | `reasoning/01_gates.txt` GATE_9 | [ ] |
| 4 | Add CLOSURE_PROOF rule to RUNTIME_RULES | `27_runtime_dict.py` | [ ] |

### P1: Define SV_STATE

**SV**: sv_state definition alias sv_format observed

SV_STATE used but undefined. Define as alias: emitted @SV_FORMAT interpreted as observed semantic state.

| # | Task | Files | Status |
|---|------|-------|--------|
| 5 | Add SV_STATE definition: "observed semantic state encoded by @SV_FORMAT — what the agent actually focused on" | `reasoning/00_map.txt` after SV_TARGET | [ ] |
| 6 | Add sv_state to core_schemas.yaml (alias, see: @SV_FORMAT) | `core_schemas.yaml` | [ ] |

### P1: Reorder semantic-control anchors

**SV**: forward_reference reorder MULTI_AGENT_SV SEMANTIC_CONTROL

SEMANTIC_CONTROL (from YAML via @schema: in 00b_schemas) appears before MULTI_AGENT_SV (in 00c_algorithms). Violates kernel ABI: refs resolve to definitions above. Move @schema: marker.

| # | Task | Files | Status |
|---|------|-------|--------|
| 7 | Remove `# @schema: semantic_control` from 00b_schemas.txt | `reasoning/00b_schemas.txt` | [ ] |
| 8 | Add `# @schema: semantic_control` to 00c_algorithms.txt AFTER MULTI_AGENT_SV | `reasoning/00c_algorithms.txt` | [ ] |

### P2: Soften mechanistic attention wording

**SV**: wording soften attention inference contextual conditioning

"primes attention heads" → "steers subsequent inference toward specified semantic directions through contextual conditioning"

| # | Task | Files | Status |
|---|------|-------|--------|
| 9 | Change wording in SV_TARGET description | `reasoning/00_map.txt` SV_TARGET section | [ ] |

## Verification

1. `python -m pytest prompts_kernel/tests/ -q` — 490 passed
2. Explorer agent: no forward refs, SV_STATE defined, GATE_3 identity correct
3. Check assembled kernel: SEMANTIC_CONTROL AFTER MULTI_AGENT_SV

## Claim Ledger

| ID | Text | Status |
|----|------|--------|
| C1-C7 | Previous premises | Exact |
| C8 | GATE_3 identity mismatch | Exact |
| C9 | Terminal semantics incomplete | Exact |
| C10 | SV_STATE undefined | Exact |
| C11 | Forward reference SEMANTIC_CONTROL→MULTI_AGENT_SV | Exact |
| C12 | Mechanistic "attention heads" claim | Exact |
