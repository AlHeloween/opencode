# PLANNING spec dedup

## Problem
`## PLANNING` (24_specs_policies.py, 55 lines) recapitulates G2+G3+G7+G9.
Every fact already exists in `<gates>` YAML. Model sees duplicate information.

## Fix
Replace PLANNING spec with `see:` reference to gates.
Same pattern as GROUNDING_RULES → `see: G1`.

## Files changed
| File | Change |
|------|--------|
| `24_specs_policies.py` | PLANNING → compact `see: G2, G3, G7, G9` |
| `28_runtime_render.py` | Already includes PLANNING |

## After
```python
PLANNING = _spec(
    intent="ADID fractal task geometry. See: G2 (DECOMPOSE), G3 (MASTER_PLAN), G7 (IMPLEMENT), G9 (CLEAN_STATE) in reasoning.txt gates.",
    state={},
    scope="task geometry — see gates",
    constraints={"see": "G2, G3, G7, G9"},
    invariants=[],
    forbidden_actions=[],
    acceptance_tests=[],
)
```

## Impact
- 55 lines prose → 8 lines reference
- No information loss — all facts in gates
- policy.planning contract still resolves (WORKFLOWS reference it)

## Smoke tests
```bash
python build.py --full --only kernel
python -m pytest prompts_kernel/tests/ -q
```
Target: 482 passed.
