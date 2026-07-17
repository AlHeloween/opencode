# Reasoning Framework Architecture

**Status:** production  
**Last Updated:** 2026-07-17  
**Canonical Source:** `opencode_prompts_kernel.py`

---

## Overview

The reasoning framework is a three-layer architecture that treats AI instructions
as compilable, testable, immutable code. Each layer adds a concern:

1. **PromptSpec Schema** — validates every instruction file against a 7-field contract
2. **Projection Layers** — maps kernel concepts to syntax (code) and epistemic structure (disciplines)
3. **IR Compilation** — compresses and immutabilizes the result

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PROMPT SPEC SCHEMA (Layer 1)                      │
│  Validates every instruction file against 7-field contract           │
│                                                                      │
│  intent │ state │ scope │ constraints │ invariants                   │
│  forbidden_actions │ acceptance_tests                                │
│                                                                      │
│  Files checked:                                                      │
│  agent/*.txt  session/*.txt  SKILL.md  .mdc  AGENTS.md              │
│  → 60 pytest tests validate all 50+ files                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 SYNTAX PROJECTION (Layer 2a)                         │
│  Maps kernel fields → target format syntax                          │
│                                                                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐         │
│  │ .agent.txt     │  │ .session.txt   │  │ .mdc rule      │         │
│  │ # === SCOPE ===│  │ scope:         │  │ scope:         │         │
│  │ for k,v in ... │  │ - item         │  │ - item         │         │
│  └────────────────┘  └────────────────┘  └────────────────┘         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐         │
│  │ SKILL.md       │  │ AGENTS.md      │  │ plan.txt       │         │
│  │ scope:         │  │ scope:         │  │ intent:        │         │
│  │ - item         │  │ - item         │  │ ...            │         │
│  └────────────────┘  └────────────────┘  └────────────────┘         │
│                                                                      │
│  → 18 pytest tests verify all 7 fields × 7 formats                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 PROJECTION PACKS (Layer 2b)                          │
│  Language-aware compiler targets for kernel concepts                 │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │ Python     │  │ TypeScript │  │ Markdown   │  │ YAML       │     │
│  │ semantic:  │  │ semantic:  │  │ semantic:  │  │ semantic:  │     │
│  │  def,class │  │  function  │  │  ## heading │  │  mapping   │     │
│  │ templates: │  │ templates: │  │ templates: │  │ templates: │     │
│  │  dataclass │  │  interface │  │  checklist │  │  sequence  │     │
│  │ grammar:   │  │ grammar:   │  │ grammar:   │  │ grammar:   │     │
│  │ tree-sit-  │  │ tree-sit-  │  │ tree-sit-  │  │ tree-sit-  │     │
│  │ ter-python │  │ ter-ts     │  │ ter-md     │  │ ter-yaml   │     │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │
│                                                                      │
│  → 18 pytest tests verify pack completeness and rendering            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│               EPISTEMIC PROJECTION (Layer 2c)                        │
│  Discipline-aware reasoning structure for any knowledge domain       │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Universal Research Kernel                                    │    │
│  │  question_type │ ontology │ evidence │ uncertainty            │    │
│  │  assumptions │ falsifiers │ method                            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│          │                            │                              │
│          ▼                            ▼                              │
│  ┌──────────────────┐    ┌──────────────────────┐                   │
│  │ NATURAL SCIENCE  │    │ SOCIAL SCIENCE       │                   │
│  │ units, dimensions│    │ constructs, sampling │                   │
│  │ boundary conds   │    │ identification       │                   │
│  ├────────┬────────┤    ├───────┬──────┬──────┤                   │
│  │Physics │Chem │Bio│    │Econ │Psych │Sociol│                   │
│  │conserv │balan│rep│    │ID   │power │struct│                   │
│  │symmetry│phase│cntl│    │endo │valid │network│                   │
│  └────────┴─────┴───┘    └──────┴──────┴──────┘                   │
│                                    ┌──────┐                        │
│                                    │History│                       │
│                                    │source │                       │
│                                    │proven.│                       │
│                                    │chrono.│                       │
│                                    └──────┘                        │
│                                                                      │
│  → 25 pytest tests verify all 9 projections, precedence, selection  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 PROMPT IR COMPILATION (Layer 3)                      │
│  Immutable namespace prefixes for compact, collision-free IR         │
│                                                                      │
│  Readable Source:              Compiled IR:                          │
│  ┌──────────────────────┐    ┌──────────────────────┐               │
│  │ {                    │    │ {                    │               │
│  │   "constraints": [   │ →  │   "_k_cst": [        │               │
│  │     "must be safe"   │    │     "must be safe"   │               │
│  │   ],                 │    │   ],                 │               │
│  │   "invariants": [    │    │   "_k_inv": [        │               │
│  │     "never commit"   │    │     "never commit"   │               │
│  │   ]                  │    │   ]                  │               │
│  │ }                    │    │ }                    │               │
│  └──────────────────────┘    └──────────────────────┘               │
│                                                                      │
│  @compile_to_ir    @expand_from_ir    @validate_symbols              │
│  @validate_ir_equivalence                                            │
│                                                                      │
│  Namespace prefixes:                                                 │
│  _k_ kernel │ _py_ Python │ _ts_ TypeScript │ _md_ Markdown         │
│  _sci_ science │ _phy_ physics │ _chm_ chemistry │ _bio_ biology    │
│  _soc_ social │ _eco_ economics │ _psy_ psychology                   │
│  _hist_ history                                                      │
│                                                                      │
│  Runtime guarantee: MappingProxyType rejects all mutations            │
│  _KERNEL_SYMBOLS["_k_new"] = x  →  TypeError                         │
│                                                                      │
│  → 22 pytest tests verify compilation, expansion, immutability       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    290 PYTEST TESTS (CI GATE)                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 165 reasoning kernel & contract tests (enums, validation,    │   │
│  │     state machines, classification, bug fix protocol)         │   │
│  │  60 prompt schema conformance tests (every .txt/.md/.mdc)     │   │
│  │  18 syntax projection tests (field → format completeness)     │   │
│  │  25 epistemic projection tests (9 disciplines + precedence)   │   │
│  │  22 IR compilation tests (compile → expand → validate)        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Every layer is tested independently. The CI gate prevents:          │
│    • Unstructured instructions (no spec fields)                      │
│    • Unknown reserved symbols (_k_* without definition)              │
│    • Discipline invariant violations (no units in physics)           │
│    • IR roundtrip failure (compile ≠ expand)                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Runtime identity tiers

| Tier | Contents | Where |
|------|----------|--------|
| **A (identity)** | `PROMPT_ABI`, TERMS/RULES/WORKFLOWS/PACKS/CONTRACTS + **agent + policy** SPECS | `opencode_prompts_kernel.txt` — system identity prefix |
| **B (surfaces)** | Skill + command SPECS | `SKILL.md` / command templates — loaded when used |
| **C (offline)** | Full SPECS via `render_runtime_kernel(tier="full")` | Docs / debug only |

Budget: `PROMPT_ABI["identity_max_bytes"]` (48 000). CI fails if Tier A exceeds it.

Memory ranks (InfoMark) live in TERMS/RULES (`infomark`, `MEMORY.RANK`, `MEMORY.LINKS`) and on compaction surfaces — see `docs/compaction.md`.

TS mirror (risk + InfoMark helpers): `packages/opencode/src/session/constitution.ts`

- **DESTRUCTIVE shell** (`rm -rf`, `git push --force`, `reset --hard`, …) requires permission **`destructive`** (not `bash:*`, so auto-allow bash cannot skip it), or `OPENCODE_ALLOW_DESTRUCTIVE=1`
- Plan agent: `destructive: deny`. Explore: covered by `*: deny`.
- **ELEVATED** shell / edit / write / multiedit / apply_patch: logged (permissions still apply)
- **session-read** output: `info_mark: Exact`
- **messagesearch** output: `info_mark: Inferred` (use session-read for Exact)

Kernel honesty: `EXTERNAL_ORACLE_TEST_IDS` lists conformance stubs that need OS/sandbox hooks; `kernel_closed_test_ids()` is the falsifiable subset.

## Key Design Decisions

### Why three layers?

Each layer solves a different failure mode:

| Layer | Failure Mode | Prevention |
|-------|-------------|------------|
| PromptSpec | Unstructured drift | Schema validation rejects files without spec fields |
| Projection | Format inconsistency | Predefined mappings for every target format |
| IR Compilation | Namespace collision | Prefixes isolate kernel from projections |

### Why _k_ prefix?

The single-underscore prefix `_k_` was chosen over double-underscore `__k_` because
Python name mangling only applies to `__` inside classes. The single underscore
communicates "reserved, internal, do not casually modify" without activating an
unrelated Python feature.

### Why `MappingProxyType`?

`MappingProxyType` provides runtime immutability — any attempt to mutate a
kernel symbol dict raises `TypeError` immediately, catching bugs at definition
time rather than at inference time.

### Why hierarchy for epistemic projections?

The hierarchy `Universal → Natural/Social → Physics/Economics` mirrors how
knowledge actually works: general principles constrain domain-specific methods.
The `PRECEDENCE` table formalizes which level wins in case of conflict.

---

## File Reference

| File | Purpose |
|------|---------|
| `opencode_prompts_kernel.py` | Canonical kernel (all layers, ~3000 lines) |
| `opencode_prompts_kernel.txt` | Synced copy loaded as system prompt prefix |
| `_prompts/reasoning_kernel.py` | Inference kernel (layer 1 + spec system) |
| `_prompts/reasoning.txt` | Protocol specification document |
| `tests/test_reasoning_kernel.py` | 230+ pytest tests for kernel, projection, IR |
| `tests/test_prompt_schema.py` | 60 pytest tests for prompt file conformance |

---

## Running the Tests

```bash
# All tests
pytest tests/

# Specific layers
pytest tests/test_reasoning_kernel.py -v -k TestEnums
pytest tests/test_reasoning_kernel.py -v -k TestContractValidation
pytest tests/test_reasoning_kernel.py -v -k TestSyntaxProjection
pytest tests/test_reasoning_kernel.py -v -k TestEpistemicProjection
pytest tests/test_reasoning_kernel.py -v -k TestPromptIR
pytest tests/test_prompt_schema.py -v
```

## CI Integration

The 290-test suite is designed as a CI gate. Add to CI pipeline:

```yaml
test-reasoning-framework:
  script: pytest tests/
  required: true
  blocking: true
```
