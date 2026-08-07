# Fix non-@ references across prompts_kernel

## Goal
Every cross-reference in the codebase uses `@REF` format so refcheck can verify resolution. Currently ~19 instances of bare references (`See: G1`, `Gate 4`, `execution_envelope`) scattered across 6 source files.

## Files & changes (priority order)

### 1. `prompts_kernel/27_runtime_dict.py` — RUNTIME_RULES prose (5 fixes)
| Line | Old | New |
|------|-----|-----|
| 45 | `See: G1.search_intent.` | `See: @G1.search_intent.` |
| 48 | `See: G1.search_intent.` | `See: @G1.search_intent.` |
| 57 | `See: G2.fractal_dispatch.` | `See: @G2.fractal_dispatch.` |
| 63 | `Gate 4 approval` | `@G4 approval` |
| 78 | `Gate 8: only PASS` | `@G8: only PASS` |

### 2. `prompts_kernel/26_specs_grounding.py` — GROUNDING_RULES spec (6 fixes)
| Line | Field | Old | New |
|------|-------|-----|-----|
| 1 | docstring | `G1 grounding` | `@G1 grounding` |
| 6 | constraints/see | `G1.search_intent` | `@G1.search_intent` |
| 7 | constraints/see_also | `SEARCH_ORDER, EVIDENCE_ORDER, ...` | `@SEARCH_ORDER, @EVIDENCE_ORDER, ...` |
| 10 | invariant | `per G1.search_intent` | `per @G1.search_intent` |
| 18 | acceptance | `per G1.search_intent` | `per @G1.search_intent` |
| 20 | state/source | `G1 in reasoning.txt` | `@G1 in reasoning.txt` |

### 3. `prompts_kernel/24_specs_policies.py` — PLANNING constraint (1 fix)
| Line | Field | Old | New |
|------|-------|-----|-----|
| 80 | constraints/see | `G2, G3, G7, G9` | `@G2, @G3, @G7, @G9` |

### 4. `prompts_kernel/25_specs_default.py` — DEFAULT_PROMPT scope (1 fix)
| Line | Field | Old | New |
|------|-------|-----|-----|
| 5 | scope | `use AGENT_DIRECTIVES` | `use @AGENT_DIRECTIVES` |

### 5. `prompts_kernel/core_schemas.yaml` — mirror of RUNTIME_RULES (5 fixes)
| Key path | Old | New |
|----------|-----|-----|
| rules.G1.SEARCH_ORDER | `See: G1.search_intent.` | `See: @G1.search_intent.` |
| rules.G1.GROUND | `See: G1.search_intent.` | `See: @G1.search_intent.` |
| rules.G2.GOAL_PEAKS | `See: G2.fractal_dispatch.` | `See: @G2.fractal_dispatch.` |
| master_plan.oracle | `see stamps.oracle` | `see @STAMPS.oracle` |
| master_plan.action_class | `see action_class schema` | `see @ACTION_CLASS schema` |
| master_plan.claim_ledger | `see claim_ledger schema` | `see @CLAIM_LEDGER schema` |

### 6. `prompts_kernel/06_contracts.py` — contract prose (2 fixes)
| Line | Old | New |
|------|-----|-----|
| 73 | `See ExecutionEnvelope` | `See @EXECUTION_ENVELOPE` |
| 95-96 | `Gate 4` in docstring | `@G4` |

### 7. Low-priority: comments only (3 files, optional)
- `01_enums.py`: `Gate 4` in docstrings → `@G4` (3 places)
- `09_execution_permit.py`: `Gate 4` in comments → `@G4` (2 places)
- `14_plan_cluster.py`: `Gate 1/4/8` in comments → `@G1/@G4/@G8` (4 places)

## Post-fix actions
1. Regenerate `_kernel_precompiled.py`: `write_precompiled_kernel()`
2. Regenerate `reasoning_prompt.mdc`: `write_reasoning()`
3. Run `refcheck`: verify all @refs resolve (expect 72+ new refs from constraints/see_also)
4. Run full test suite: `pytest prompts_kernel/tests/ -q` (expect 482 passed)

## Smoke Tests
```bash
# 1. Rebuild precompiled kernel
python -c "from prompts_kernel._assemble_prompts_kernel import write_precompiled_kernel; write_precompiled_kernel()"

# 2. Regenerate .mdc artifact
python -c "from prompts_kernel._assemble_prompts_kernel import write_reasoning; write_reasoning()"

# 3. Verify @refs resolve
python -m prompts_kernel.tools.refcheck

# 4. Full test suite
python -m pytest prompts_kernel/tests/ -q
```
Expected: 0 unresolved @refs, 482 passed, 23 runtime tests passed.

## What NOT to change
- `RUNTIME_RULE_CATEGORIES` dict values (`"G1".."G9"`) — functional data for renderer
- `contract=`, `RUNTIME_WORKFLOWS`, `RUNTIME_CONTRACTS` — identifiers, @ added at render time
- `# G1: GROUND` section comments — structural, not references
- `02_diagrams.txt` Mermaid node IDs (`G1[G1 GROUND]`) — diagram syntax
- `03_schemas.txt` `@schema:` markers — special syntax, already correct
