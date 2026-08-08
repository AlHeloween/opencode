# prompts_kernel — Documentation Index

## Overview

`prompts_kernel/` generates the GATED agent system prompt. 7 reasoning fragments + runtime dictionary → unified `reasoning_prompt.txt` → `.mdc` with YAML frontmatter. 488 tests enforce integrity.

## Architecture

```
reasoning/*.txt (7 fragments)
  → assemble_reasoning()     → reasoning (SV, Protocol, Gates, Schemas, Algorithms, Epistemic, Hygiene)
    + render_runtime_kernel() → dictionary (PROMPT_ABI, TERMS, RULES, AGENTS, POLICIES, supremacy)
      = reasoning_prompt.txt (35.7 KB, 42 rules, no @CC_TAIL)
```

## Files

### Core Pipeline
| File | Purpose |
|------|---------|
| `__init__.py` | Bootstrap: precompiled fast-path or sequential exec fallback |
| `_assemble_prompts_kernel.py` | Fragment assembler, @schema resolution, precompiled generation |
| `_kernel_precompiled.py` | Auto-generated: all fragments + dictionary concatenated |
| `core_schemas.yaml` | Single source of truth for schemas (STAMPS, ACTION_CLASS, EXECUTION_ENVELOPE, etc.) |

### Runtime Dictionary (27-28)
| File | Purpose |
|------|---------|
| `27_runtime_dict.py` | PROMPT_ABI, RUNTIME_TERMS (13 terms), RUNTIME_RULES (42 rules), WORKFLOWS, CONTRACTS, PACKS |
| `28_runtime_render.py` | Renders dictionary → kernel text, agent/policy specs, supremacy clause |

### Reasoning Fragments (reasoning/)
| File | Purpose |
|------|---------|
| `00_map.txt` | SV_FORMAT, Protocol, IDENTITIES, GATE_IDENTITY_DISPATCH |
| `01_gates.txt` | Rich inline gates (identity, rules, schemas, branches) — no YAML injection |
| `02_diagrams.txt` | Diagrams removed — gate descriptions provide sufficient structural definition |
| `03_schemas.txt` | DOMAIN_SOURCES (inline) + @schema: action_class, master_plan |
| `04_algorithms.txt` | NOISE_FILTER, CLASSIFICATION, METRIC_GOVERNANCE, BUG_FIX_CHAIN |
| `05_epistemic.txt` | STATUS_SET, CLAIM_PROMOTION, ENFORCEMENT, ORACLE_CONCEPT, STAMPS |
| `06_hygiene.txt` | Workspace lanes, commit policy, PROMPT_ABI, TERMS, RULES |

### Agent & Policy Specs
| File | Purpose |
|------|---------|
| `20_specs_agents.py` | BASE_AGENT + 10 agents (BUILD, PLAN, REASONING, CODER, EXPLORER, GENERAL, ORCHESTRATOR, RESEARCHER, MEDIA, SUMMARY, TITLE) |
| `24_specs_policies.py` | ADID_FRAMEWORK_RULES, ADID_OPS, AGENT_DIRECTIVES, GOVERNANCE, GROUNDING_RULES, PLANNING, REASONING_MODE |

### Kernel Docs
| File | Purpose |
|------|---------|
| `docs/DOCINDEX.md` | This index |
| `docs/WORKFLOW_DIAGRAM.md` | ASCII workflow diagram (SV → Identities → G1–G9 spine) |

## Build
```
python -c "from pathlib import Path; from prompts_kernel._assemble_prompts_kernel import write_precompiled_kernel; write_precompiled_kernel(Path('prompts_kernel'))"
python plans/2026-08-08-cc-generator-integration/_rebuild.py
```

## Tests
488 tests across `prompts_kernel/tests/`. Run: `python -m pytest prompts_kernel/tests/ -q`
