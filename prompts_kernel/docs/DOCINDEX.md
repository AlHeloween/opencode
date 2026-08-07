# prompts_kernel — Documentation Index

## Overview

`prompts_kernel/` is a Python package that generates the GATED agent system prompt.
31 fragments → assembler → unified `reasoning_prompt.mdc` with YAML frontmatter.
482 tests enforce structural integrity.

## Files

### Core Pipeline
| File | Purpose |
|------|---------|
| `__init__.py` | Bootstrap: precompiled fast-path or sequential exec fallback |
| `_assemble_prompts_kernel.py` | Fragment assembler, @schema resolution, .mdc generation |
| `_kernel_precompiled.py` | Auto-generated: all 31 fragments concatenated (10× import speedup) |
| `core_schemas.yaml` | Single source of truth for all data schemas |

### Runtime Dictionary (27-28)
| File | Purpose |
|------|---------|
| `27_runtime_dict.py` | PROMPT_ABI, RUNTIME_TERMS, RUNTIME_RULES (39 rules), WORKFLOWS, CONTRACTS, PACKS |
| `28_runtime_render.py` | Renders dictionary → kernel text, budget check, artifact write |

### Reasoning Fragments (reasoning/)
| File | Purpose |
|------|---------|
| `00_map.txt` | Semantic Vector format, Protocol, Identity |
| `01_gates.txt` | Gate definitions with @schema: injection |
| `02_diagrams.txt` | Mermaid diagrams (spine, fractal, auth, oracle, noise, metrics, bug fix, epistemic) |
| `03_schemas.txt` | Schema references resolved from core_schemas.yaml |
| `04_algorithms.txt` | Noise filter, classification, metric governance, bug fix chain |
| `05_epistemic.txt` | Claim Promotion (complete flow), statuses, stamps, oracle, enforcement |
| `06_hygiene.txt` | Workspace lanes, commit policy, secret handling, fact recovery |

### Enums & Data Structures (01-19)
| File | Purpose |
|------|---------|
| `01_enums.py` | Activity, EpistemicStatus, TaskStatus enums |
| `02_info_mark.py` | ClaimNode, EpistemicDAG, promotion/demotion logic |
| `03_semantic_vector.py` | SV data structures |
| `04_delta.py` | SV delta computation (L1 distance) |
| `05_svm_anchor.py` | SV anchor management |
| `06_contracts.py` | Contract definitions |
| `07_digest.py` | SHA-256 digest utilities |
| `08_validation.py` | Validation framework |
| `09_execution_permit.py` | Execution permit/envelope |
| `10_state_machine.py` | State machine |
| `11_state_record.py` | State recording |
| `12_classification.py` | Action classification |
| `13_bug_fix.py` | Bug fix chain |
| `14_plan_cluster.py` | Fractal geometry (Sierpinski, Quad/Oct, L-System, k-medoids, CLARA) |
| `15_handlers.py` | Handlers |
| `16_example.py` | Examples |
| `17_communication.py` | Communication rules |
| `18_conformance.py` | Conformance |
| `19_specs_base.py` | Spec base classes |

### Agent & Policy Specs (20-26)
| File | Purpose |
|------|---------|
| `20_specs_agents.py` | CODER, EXPLORER, ORCHESTRATOR, GENERAL, RESEARCHER, MEDIA, TITLE, SUMMARY |
| `21_skills_boundary.py` | Skills boundary |
| `22_specs_commands.py` | COMMIT, LEARN, CHANGELOG, ISSUES, TRANSLATE, RMSLOP, AI_DEPS, SPELLCHECK, etc. |
| `23_specs_github.py` | GitHub specs |
| `24_specs_policies.py` | ADID_FRAMEWORK_RULES, ADID_OPS, AGENT_DIRECTIVES, GOVERNANCE, etc. |
| `25_specs_default.py` | DEFAULT_PROMPT |
| `26_specs_grounding.py` | GROUNDING_RULES |

### Syntax & IR (29-31)
| File | Purpose |
|------|---------|
| `29_syntax.py` | Syntax projection |
| `30_epistemic.py` | Epistemic projections per discipline |
| `31_prompt_ir.py` | Prompt IR compilation |

## Tools (`tools/`)
| Tool | Purpose |
|------|---------|
| `refcheck.py` | Validates @REF → anchor resolution |
| `refgraph.py` | Builds optimal BFS navigation graph from @tags |
| `refdupes.py` | BGE v1.5 semantic duplicate detection + top-N neighbors |
| `tag_sections.py` | Auto-tags fragment sections with @ANCHOR references |
| `kernel_graph.py` | Source dependency graph for prompts_kernel modules |

## Tests (`tests/`)
27 test files, 482 tests covering: enums, info_mark, SV, delta, contracts, validation, execution, state machine, classification, bug_fix, plan_cluster, handlers, specs, runtime dict, render, syntax, epistemic, integration, prompt schema, tool consistency.

## Build
```
python -m prompts_kernel --render-runtime → prompts_kernel.txt
prompts_kernel/_assemble_prompts_kernel.py → reasoning.txt
Both merged → reasoning_prompt.mdc with YAML frontmatter
```
