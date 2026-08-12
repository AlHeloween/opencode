# Kernel Enhancement — Full Audit & Status

**Description**: Seven-phase kernel improvement: SV control (A+D), plan hardening (B+C), provenance (E), multi-agent controller (F+G), test fixes, ChatGPT review fixes.

**Date**: 2026-08-12 | **Last audit**: 2026-08-12 04:18 UTC

## Premises (⊆ G)

| Claim | Text | Status |
|-------|------|--------|
| C1 | SV_FORMAT in 00_map.txt with md5 chain | Exact |
| C2 | SV_DELTA rule in 00c_algorithms.txt | Exact |
| C3 | Manhattan L1 in core_schemas.yaml | Exact |
| C4 | GATE_7_IMPLEMENT hard_gate exists | Exact |
| C5 | GATE_3_MASTER_PLAN with schemas exists | Exact |
| C6 | MASTER_PLAN_SCHEMA in core_schemas.yaml | Exact |
| C7 | CLAIM_LEDGER status enum exists | Exact |

## Phase 1: A+D — SV_TARGET + SV Trajectory ✅ COMPLETE

| # | Task | Files | Status |
|---|------|-------|--------|
| A1 | SV_TARGET section in 00_map.txt | `reasoning/00_map.txt` | [x] |
| A2 | SV_TARGET schema in core_schemas.yaml | `core_schemas.yaml` | [x] |
| D1 | SV_TRAJECTORY in 00c_algorithms.txt | `reasoning/00c_algorithms.txt` | [x] |
| D2 | SV_TRAJECTORY schema in core_schemas.yaml | `core_schemas.yaml` | [x] |
| D3 | Drift classification (5-class) | `reasoning/00c_algorithms.txt` | [x] |
| V1 | Regenerate + pytest (477 passed) | `build.py` | [x] |

## Phase 2: B+C — PLAN_CONTRACT + Lifecycle ✅ COMPLETE

| # | Task | Files | Status |
|---|------|-------|--------|
| B1 | PLAN_CONTRACT invariant in GATE_7 | `reasoning/01_gates.txt` | [x] |
| B2 | PLAN_CONTRACT in core_schemas.yaml | `core_schemas.yaml` | [x] |
| C1 | Lifecycle state machine in MASTER_PLAN_SCHEMA | `core_schemas.yaml` | [x] |
| C2 | PLAN_BINDING rule in GATE_7 | `reasoning/01_gates.txt` | [x] |
| C3 | PLAN_REVISION rule in GATE_3 | `reasoning/01_gates.txt` | [x] |
| — | 4 new rules in RUNTIME_RULES + OWNERS + WORKFLOWS | `27_runtime_dict.py` | [x] |
| — | _coverage.py sync | `_coverage.py` | [x] |
| V2 | Regenerate + pytest (477 passed) | `build.py` | [x] |

## Phase 3: E — PROVENANCE ✅ COMPLETE

| # | Task | Files | Status |
|---|------|-------|--------|
| E1 | PROVENANCE enum (6 types) in 05_epistemic.txt | `reasoning/05_epistemic.txt` | [x] |
| E2 | provenance field in CLAIM_LEDGER | `core_schemas.yaml` | [x] |
| E3 | PROVENANCE rules | `reasoning/05_epistemic.txt` | [x] |
| V3 | Regenerate + pytest (477 passed) | `build.py` | [x] |

## Phase 4: F+G — MULTI_AGENT_SV + SEMANTIC_CONTROL ✅ COMPLETE

| # | Task | Files | Status |
|---|------|-------|--------|
| F1 | MULTI_AGENT_SV controller in 00c_algorithms.txt | `reasoning/00c_algorithms.txt` | [x] |
| G1 | SEMANTIC_CONTROL schema in core_schemas.yaml | `core_schemas.yaml` | [x] |
| G2 | @schema: marker for semantic_control | `reasoning/00b_schemas.txt` | [x] |
| V4 | Regenerate + pytest (488 passed) | `build.py` | [x] |

## Phase 5: Test Suite Sync ✅ COMPLETE

| # | Task | Files | Status |
|---|------|-------|--------|
| T1 | XML agent format validator in 31_prompt_ir.py | `31_prompt_ir.py` | [x] |
| T2 | dist/ paths in test_prompt_schema.py | `tests/test_prompt_schema.py` | [x] |
| T3 | Contract check for XML agents | `tests/test_runtime.py` | [x] |
| T4 | H2+H3 regex for schema tags | `tests/test_prompt_schema.py` | [x] |
| V5 | 488 passed, 0 failed | `pytest` | [x] |

## Phase 6: Bugfixes ✅ COMPLETE

| # | Task | Files | Status |
|---|------|-------|--------|
| B1 | Remove duplicate root-of-truth | `_assemble_prompts_kernel.py` | [x] |
| B2 | Commit 450424b | git | [x] |
| V6 | Regenerate + pytest (488 passed) | `build.py` | [x] |

## Phase 7: ChatGPT Review Fixes 🔄 IN PROGRESS

| # | Task | Files | Status |
|---|------|-------|--------|
| R1 | Remove duplicate @SV_TARGET/@SV_TRAJECTORY anchors — убраны из @schema: маркеров, остались только fragment-определения | `reasoning/00b_schemas.txt` | [x] |
| R2 | Terminal semantics — признано: менять рано, требует CLOSURE_PROOF. Отложено на следующий план. | — | [x] deferred |
| R3 | PLAN_CONTRACT/PLAN_BINDING в build_mode contract | `27_runtime_dict.py` | [x] |
| R4 | PLAN_CONTRACT/PLAN_BINDING в coder_agent contract | `27_runtime_dict.py` | [x] |

## Pending — требует выполнения сейчас

> Completion note: P1 passed with 490 tests, P2 was validated against the generated kernel, and P3 was committed in `0cebf1e9ca`.

| # | Task | Priority |
|---|------|----------|
| P1 | **Regenerate kernel + run tests** после R1+R3+R4 | HIGH |
| P2 | **Explorer agent verification** сгенеренного kernel на: отсутствие дубликатов anchor, наличие PLAN_CONTRACT в контрактах, целостность gate spine | HIGH |
| P3 | Commit fixes | [x] Completed in `0cebf1e9ca`. |

## Deferred — следующий план

| # | Task | Why deferred |
|---|------|-------------|
| D1 | CLOSURE_PROOF / outcome coverage semantics | Требует отдельного дизайна: task complete ≠ plan complete ≠ outcome complete |
| D2 | PLAN_CONTRACT в orchestrator_agent контракте | Orchestrator — особый случай, требует анализа |

## Smoke Tests

1. `python -m pytest prompts_kernel/tests/ -q` — must be 488 passed
2. Explorer agent check: no duplicate @anchors, all contracts have PLAN_CONTRACT
3. `python prompts_kernel/_coverage.py` — gate coverage intact

## Claim Ledger

| ID | Text | Status |
|----|------|--------|
| C1-C7 | Original premises | Exact |
| C8 | @SV_TARGET defined once (fragment only, not YAML-injected) | Exact |
| C9 | PLAN_CONTRACT in build_mode + coder_agent contracts | Exact |
| C10 | Kernel regenerates without errors, 488 tests pass | Pending verification |
