# prompts_kernel — TUI-agnostic prompt construction kernel

**Lineage**: The thinking kernel (`prompts_kernel`) is the **canonical runtime successor**
to the ADID Framework. ADID (v15.4.3) defines the specification and formal contract;
the kernel is its operational implementation — and takes **highest priority** over
any ADID-derived artifacts (host rules, skill trees, receiver files, or framework
docs) when both address the same concern. In case of conflict: kernel wins.

Self-contained package: code, tests, reasoning fragments, assembly — everything in one directory.

## Structure

```
prompts_kernel/
├── __init__.py                  # bootstrap → _kernel_precompiled (cached) or fallback
├── _assemble_prompts_kernel.py  # assemble reasoning.txt, algorithm_card, precompiled kernel
├── 01_enums … 31_prompt_ir      # 32 topic-sliced modules
├── 27_runtime_dict.py           # RUNTIME_TERMS (12), RUNTIME_RULES (32), WORKFLOWS (7)
├── 28_runtime_render.py         # render_runtime_kernel + validate_* functions
├── reasoning/                   # 6 fragments (00_map … 06_hygiene)
└── tests/                       # 27 test files, 481 tests
```

## Naming conventions

| Kind | Convention | Example |
|------|-----------|---------|
| **Workflow** | gerund / `_ops` | `planning`, `diagnose`, `modify`, `observe`, `research`, `adid`, `hygiene_ops` |
| **Term** (domain) | lowercase noun | `plan`, `scope`, `evidence`, `mutation`, `hygiene` |
| **Rule** | `UPPER_SNAKE_CASE` | `SMOKE_BEFORE`, `EVIDENCE_ORDER`, `VCS_ROOT` |

Python dict keys are **case-sensitive**: references in WORKFLOWS, CONTRACTS, and OWNERS must match exactly.

## Public API

```python
from prompts_kernel import (
    Activity, render_runtime_kernel, run_task_geometry,
    RUNTIME_RULES, RUNTIME_TERMS, RUNTIME_WORKFLOWS,
    smoke_before_spec, smoke_before_validate,
    smoke_before_record, smoke_before_verify,
)
```

## CLI

```bash
python -m prompts_kernel --render-runtime packages/opencode/src/session/prompt/prompts_kernel.txt
python -m prompts_kernel   # self-test (run_conformance)
```

## Tests

```bash
pytest prompts_kernel/tests/ -q   # 481 tests
```

## Build

```bash
python build.py --only kernel     # regenerates all artifacts + precompiled module
```

The precompiled module (`_kernel_precompiled.py`) is gitignored — generated at build time.
Import speed: ~100ms cached (`.pyc`), ~200ms cold. Fallback `_bootstrap()`: ~160ms always.

## Key rules

| Rule | Purpose |
|------|---------|
| `VCS_ROOT` | `.git/.fossil/.hg/` at repo root only — never search inside |
| `SMOKE_BEFORE` | baseline oracles before first edit → verify after |
| `NAMING` | `UPPER_SNAKE_CASE`, no dots/hyphens, case-sensitive references |
| `DECOMPOSE` | fractal lattice → medoids only, no Mode-1 linear shortcut |
