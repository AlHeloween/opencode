# prompts_kernel.txt — graph refactor plan

## Current state (594 lines, 55KB)

```
PROMPT_ABI         11 lines   Python dict — version, tier, byte budgets
TERMS              13 lines   11 term definitions — dense prose strings
RULES              38 lines   37 rules — key→long prose string each
WORKFLOWS           9 lines    8 workflows — key→(rule refs) tuples
PACKS              24 lines   ~25 agent/domain packs — key→(pack refs)
CONTRACTS          28 lines   ~20 contracts — key→(rule refs)
SPECS             464 lines   8 agent specs + 6 policy specs — prose walls
```

## Problems ("water")

### 1. PROMPT_ABI — Python noise + internal budgets
`MappingProxyType`, `kernel_max_bytes: 59000`, `stable_identity_slot_max_bytes: 116000` — model doesn't need byte budgets. `line_endings: LF` — implementation detail.

### 2. TERMS — prose definitions mixed with rules
`infomark` term = 500+ chars of rules. `plan` term = 300+ chars duplicating DECOMPOSE rule + PLANNING spec. TERMS should be 1-line glossary, rules should be in RULES section.

### 3. RULES — duplication with reasoning.txt gates
| Rule | Duplicates |
|------|-----------|
| `DECOMPOSE` | G2 YAML (fractal pipeline) |
| `INFOMARK_SEP` | 05_epistemic (classifier, separations) |
| `GROUND` | G1 YAML (search_intent) |
| `SEARCH_ORDER` | G1 YAML (search_intent) |
| `REUSE_BEFORE` | Already in G1 rules list |
| `SMOKE_BEFORE` / `SMOKE_SPEC` / `SMOKE_VALIDATE` / `SMOKE_VERIFY` | SMOKE_BEFORE in multiple gates |
| `RESIDUAL_LOOP` | G9 YAML (residual) |
| `EMIT_STATE` | clean_next_state schema |

### 4. WORKFLOWS / PACKS / CONTRACTS — Python tuples, not graph
These ARE a graph already (`workflow → [rule_refs]`), but in Python syntax. Model sees:
```python
'modify': ('plan', 'REUSE_BEFORE', 'SMOKE_BEFORE', ...)
```
Should be:
```yaml
modify: [plan, REUSE_BEFORE, SMOKE_BEFORE, ...]
```

### 5. SPECS — prose walls
- **GOVERNANCE** — 25 lines of evaluator capture prose. Already in core_schemas.yaml `execution_envelope`. 80% redundant.
- **GROUNDING_RULES** — 40 lines repeating G1 search_intent + EVIDENCE_ORDER + WHERE_WHICH. 60% redundant.
- **PLANNING** — 55 lines repeating G2 fractal + PLANNING policy. 50% redundant.
- **CODER / EXPLORER / ORCHESTRATOR** — agent behavior specs. These are NOT in reasoning.txt, they're unique to prompts_kernel. Keep but compact.

## Target structure

```yaml
# ─── META (was PROMPT_ABI) ───
meta:
  version: 6
  tier: A
  precedence: [safety, governance, task, domain, style]

# ─── GLOSSARY (was TERMS, compact 1-liners) ───
glossary:
  adid: "ADID receivers frozen. policy.adid_ops = product tool hygiene only."
  cache: "System content immutable within session."
  evidence: "Verified reference outranks inference."
  hygiene: "Workspace lanes isolate throwaway code."
  infomark: "Claim-local status. Only stamped Exact|Inferred enter G. Self-[Exact] rejected."
  memory: "Active set = recent msgs; full history soft-hidden; recover via session-read IDs."
  mutation: "Modify only within authorized scope."
  oracle: "Declare criteria before execute; PASS→Exact; FAIL demotes."
  plan: "ADID fractal→medoids→task store. No Mode-1 shortcut."
  scope: "Inspection does not authorize repair."
  verification: "Oracle decides correctness. ACCEPT only after oracle PASS."

# ─── RULES (key→compact YAML) ───
rules:
  ADID_OPS:
    rule: "Use product tools for file ops. Shell ONLY for build/test/package-managers."
    see: constitution_blocks
  CACHE_STABILITY:
    rule: "Keep system prefix byte-stable for session."
  DECOMPOSE:
    rule: "Fractal lattice before work list."
    see: [G2, adaptive_tau, adaptive_k, adaptive_depth, fractal_dispatch]
  GROUND:
    rule: "Generate evidence-gathering plan from goal keywords."
    see: G1
  SEARCH_ORDER:
    rule: "Intent-based routing. Tools answer different question types."
    see: G1.search_intent
  ...

# ─── GRAPH (was WORKFLOWS + PACKS + CONTRACTS) ───
workflows:
  modify: [plan, REUSE_BEFORE, SMOKE_BEFORE, SMOKE_VERIFY, scope, mutation, ...]
  planning: [plan, DECOMPOSE, SMOKE_BEFORE, GROUND, METRIC_ADAPTATION, ...]
  observe: [scope, evidence, SEARCH_ORDER, infomark, ...]
  diagnose: [scope, evidence, SEARCH_ORDER, REUSE_BEFORE, ...]
  research: [evidence, SEARCH_ORDER, REUSE_BEFORE, infomark, ...]
  hygiene_ops: [hygiene, NAMING, WORKSPACE_LANES, PROGRESS_LOG, CLEAN_STATE, ...]

contracts:
  agent.coder: [planning, scope, mutation, verification]
  agent.orchestrator: [planning, scope, evidence, verification]
  ...

# ─── AGENT SPECS (compact YAML) ───
agents:
  coder:
    rule: "Implement code. Read before edit. Verify after change."
    constraints: [read_before_modify, prefer_edit_over_write, smoke_before_first_edit]
    forbidden: [launching_task_agents, committing, inventing_workarounds_without_reuse_search]
  explorer:
    rule: "Thorough search, read-only. Adapt to thoroughness level."
    constraints: [return_absolute_paths, adapt_to_thoroughness, no_mutations]
  orchestrator:
    rule: "Read plans, delegate to sub-agents. Never write source code."
    constraints: [recursive_decomposition, smoke_tests_required, kernel_managed_task_store]
    forbidden: [writing_source_code, creating_tasks_via_todowrite]
  ...

# ─── POLICY SPECS (compact YAML) ───
policies:
  governance:
    rule: "No unapproved mutations. Every MODIFY requires ExecutionEnvelope."
    triple_separation:
      candidate_actor_id: proposes change
      oracle_actor_id: evaluates change
      promotion_actor_id: approves change
    constraint: "Capability sets must be DISJOINT across promotion lineage."
    see: [execution_envelope, action_class]
  grounding:
    rule: "Intent-based tool routing. No single linear order."
    see: [G1.search_intent, SEARCH_ORDER, WHERE_WHICH]
  planning:
    rule: "ADID fractal task geometry only."
    see: [G2, DECOMPOSE, adaptive_tau, adaptive_k, PLANNING]
  reasoning_mode:
    rule: "Memory-only Q&A. No tools, no DB, no filesystem. Offer build switch when stuck."
```

## Token impact

| Section | Before | After | Δ |
|---------|--------|-------|---|
| PROMPT_ABI → meta | 11 lines Python | 4 lines YAML | −7 |
| TERMS → glossary | 13 × long prose | 11 × 1-liner | ~−150 lines |
| RULES | 37 × long prose | 37 × compact + `see:` refs | ~−200 lines |
| WORKFLOWS/PACKS/CONTRACTS | Python tuples | YAML lists | ~−50 lines |
| SPECS (prose walls) | 464 lines | ~150 lines YAML | ~−300 lines |
| **Total** | **594 lines** | **~200 lines** | **−400 lines** |

## Source files to change

| Source | Generates |
|--------|----------|
| `27_runtime_dict.py` | PROMPT_ABI, TERMS, RULES, WORKFLOWS, PACKS, CONTRACTS |
| `20_specs_agents.py` | Agent Specs prose |
| `24_specs_policies.py` | Policy Specs prose |
| `28_runtime_render.py` | Render pipeline (may need format changes) |

## Key invariants

1. **No information loss** — rules that move to `see:` refs must be findable in reasoning.txt
2. **RULES keys preserved** — WORKFLOWS and CONTRACTS reference rule keys by UPPER_SNAKE_CASE
3. **Agent specs preserved** — CODER/EXPLORER/ORCHESTRATOR constraints are unique to kernel
4. **Backward compatible** — PACKS inheritance chain must still resolve

## Smoke tests

```bash
python build.py --full
python -m pytest prompts_kernel/tests/ -q
```
Target: 482 passed.

## Implementation order (safe, incremental)

1. **PROMPT_ABI** — strip internal budgets, keep version+tier+precedence
2. **WORKFLOWS/PACKS/CONTRACTS** — Python tuples → YAML lists (format only)
3. **TERMS** — compact 1-liners, move rule content to RULES where it belongs
4. **RULES** — add `see:` refs to reasoning.txt gates, trim prose
5. **SPECS** — trim prose walls, add `see:` refs to reasoning.txt
