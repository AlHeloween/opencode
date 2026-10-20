# Receipts — criterion K1 (the first 3x3 criterion on our own project)

Criterion: **@THREE_ORACLES is declared in the kernel, wired to G3/G8/G9,
documented in the project glossary, and exercised by the kernel suite.**

- bundle: source `prompt_kernel\source.py`, tests `prompt_kernel\tests\test_three_oracles.py`, glossary `docs\glossary.md`, plan `plans_completed\2026-10-19_kernel-three-oracles.md`
- built artifact read back: `prompt_kernel\dist\2026-10-20_11-14-25_reasoning_prompt.txt`
- measured suite: 824 passed / 0 failed (exit 0)
- installed product prompt carries the rule: yes

## Baseline

| aspect | leg | family | verdict | detail |
|---|---|---|---|---|
| D | D1 | traceability | PASS | 12 pin(s); broken: none |
| D | D3 | executable examples | PASS | 4 cited, 0 missing: none |
| D | D5 | doc<->contract diff | PASS | rule 15 ids, glossary 15 ids; only in rule: none; only in glossary: none |
| C | C1 | static wiring | PASS | gates without the rule: none |
| C | C3 | mutation control | PASS | 2 control(s); missing: none |
| C | C4 | invariant | PASS | triad-slot invariant asserted |
| E | E1 | built-artifact read-back | PASS | header=True, triad slot=True, artifact=prompt_kernel\dist\2026-10-20_11-14-25_reasoning_prompt.txt |
| E | E2 | observed vs prediction | PASS | variants=4, empty=none, identical=True, carries source text=True |
| E | E3 | end-to-end suite | PASS | measured 824 passed / 0 failed; installed sha 7e30b1f342a6160f vs pinned 7e30b1f342a6160f |

## Injected defects — who catches, who misses

| defect | injected | leg that caught it | legs that MISSED it | receipt |
|---|---|---|---|---|
| M-D1 | glossary pin points at a line that does not exist | D1 | D3, D5 | HOLDS |
| M-D3 | plan cites a smoke test that does not exist | D3 | D1, D5 | HOLDS |
| M-D5 | glossary catalogue drops a family the rule declares | D5 | D1, D3 | HOLDS |
| M-C1 | G3 loses the rule in shared_rules | C1 | C3, C4 | HOLDS |
| M-C3 | mutation-control test renamed away | C3 | C1, C4 | HOLDS |
| M-C4 | triad-slot invariant test renamed away | C4 | C1, C3 | HOLDS |
| M-E1 | built artifact no longer carries the rule block | E1 | E2, E3 | HOLDS |
| M-E2 | declared rule text drifts from the rendered block | E2 | E1, E3 | HOLDS |
| M-E3 | measured suite result drifts from the plan's record | E3 | E1, E2 | HOLDS |

## Verdict per aspect

- **D**: 3 leg(s) with a unique-detection receipt (D1, D3, D5) — COVERED (>=3)
- **C**: 3 leg(s) with a unique-detection receipt (C1, C3, C4) — COVERED (>=3)
- **E**: 3 leg(s) with a unique-detection receipt (E1, E2, E3) — COVERED (>=3)

Every leg carries a unique-detection receipt.
