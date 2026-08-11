# Remaining Kernel Fixes

## 1. Rename Gate Refs: @G1→@GATE_1_GROUND

**Problem**: `@G4` meaningless. What gate? What does it do?
**Fix**: Rename all 9 gate anchors and references.

| Old | New |
|-----|-----|
| @G1 | @GATE_1_GROUND |
| @G2 | @GATE_2_DECOMPOSE |
| @G3 | @GATE_3_MASTER_PLAN |
| @G4 | @GATE_4_AUTHORIZE |
| @G5 | @GATE_5_CONCERN_LOOP |
| @G6 | @GATE_6_GROUND_PLAN |
| @G7 | @GATE_7_IMPLEMENT |
| @G8 | @GATE_8_ORACLE |
| @G9 | @GATE_9_CLEAN_STATE |

**Files**: `01_gates.txt`, `00_map.txt`, `28_runtime_render.py`, `27_runtime_dict.py`, `20_specs_agents.py`, tool descriptions, `core_schemas.yaml`

**Risk**: High — touches many files. But mechanical rename, grep+replace.

## 2. Remaining Forward References (10)

| Ref | Gap | Root cause | Fix |
|-----|-----|-----------|-----|
| @GATE_8_ORACLE | 318 | algorithm_routing before gates | Move algorithm_routing after gates, or reference by name not @ref |
| @GATE_4_AUTHORIZE | 185 | agent table before gates | Gate dispatch table uses bare G4 — no @ref needed after rename |
| @GATE_1_GROUND | 129 | agent dispatch table | Same — after rename, use descriptive names |
| @GATE_2_DECOMPOSE | 141 | agent dispatch table | Same |
| @GATE_9_CLEAN_STATE | 148 | agent dispatch table | Same |
| @SMOKE_BEFORE | 101 | Gate G3 references before RULES | Rules are already before gates (we moved dictionary). Check: is RULES before gates? |
| @ADID_OPS | 357 | Gate G7 references before RULES | Same as above |
| @STAMPS | 54 | algorithm_routing before STAMPS schema | STAMPS now first schema — should be close |
| @CLAIM_LEDGER | 77 | G3 schemas before CLAIM_LEDGER | Schemas section — CLAIM_LEDGER comes after STAMPS |
| @AGENT_DIRECTIVES | 159 | Agent specs before policy specs | Acceptable — specs are at end |

**After gate rename**: agent dispatch table refs disappear (they're no longer @refs). Remaining: ~6 forward refs, all small gaps.

## 3. Schemas Format: YAML Code Blocks

**Problem**: Current format `## NAME (@NAME)` + indented YAML is ugly.
**Fix**: Change to ` ```yaml ... ``` ` blocks. Requires modifying `_section_to_comment_lines()` in assembly.

## 4. Tests and Guardrails Update

After gate rename: update test assertions, refcheck baseline, guardrail patterns.

## Execution Order

1. Gate rename (mechanical, high impact)
2. Check forward refs after rename (expect significant reduction)
3. Schema format (cosmetic)
4. Test fixes
5. Final verification
