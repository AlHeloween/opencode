# Kernel gate ↔ dictionary ref flow

**Status:** active  
**Date:** 2026-08-07  
**Related:** `plans/2026-08-07_kernel_ref_prompt_alignment.md` (tool/mode parasites)  
**This plan:** **inside** `reasoning_prompt.mdc` — algorithm/gate steps must be **dictionary refs**, not a second procedure dialect.

---

## Problem

The native system protocol has **two competing ways to state the same law**:

| Layer (order in mdc) | What the model sees | Linkage |
|----------------------|---------------------|---------|
| **Gates G1–G9** (early, ~L78–222) | `rules:` lists of **bare** names (`DECOMPOSE`, `REUSE_BEFORE`) + **prose `steps:`** | Not `@RULE` |
| **Algorithms** (~L767) | `@NOISE_FILTER` etc. with bodies | Partial `@` |
| **PROMPT_ABI + RULES** (~L864+) | Full dictionary bodies | Source of truth — but **late** and **not required** by gate syntax |

### Exact findings (audit of assembled mdc)

1. **Every gate `rules:` entry is bare** — e.g. `- DECOMPOSE`, not `- @DECOMPOSE`. There is no formal “lookup `@X` in RULES” hop; the model must invent string equality.
2. **G2 `steps:` are freestyle algorithms** with **zero `@` refs**:
   - `2a: goal_seeds(...)` — duplicates `RULES.GOAL_SEEDS` prose  
   - `2b: generate_fractal_candidates(...)` — duplicates `RULES.FRACTAL_CANDIDATES`  
   Same procedure, **second submodality** (sticky-step dialect vs dictionary).
3. **No gate step is a rule chain.** Steps `@refs: NONE (prose only)` for all G1–G9.
4. **G5 has zero rules** — concern loop is free prose only.
5. **10 RULES never hang on any gate** (e.g. `READ_ENTIRE_FILE`, `NO_SCRIPT_EDITING`, `MEMORY_RANK`, `MEMORY_LINKS`, `ADID_FREEZE`, hygiene/tone) — live only in the late dictionary, easy to miss.
6. **Document order fights lookup:** spine + dense geometry/steps first; **RULES at line ~881**. Flow is “do steps from memory of prose,” not “resolve `@RULE` bodies.”
7. **Inconsistent diagram tags:** gates say `diagram: fractal_pipeline` (bare) while sections are `## FRACTAL_PIPELINE (@FRACTAL_PIPELINE)`.
8. **`algorithm_routing`** already uses `@NOISE_FILTER` / `@BUG_FIX_CHAIN` — good pattern — but **gates do not** follow it for rules/steps.
9. Gate rule names **do** all exist in `RULES` (good data); the bug is **syntax/flow**, not missing keys.

This is the same class of bug as tool essays: **algorithm steps that are not refs pollute the native dictionary channel.**

---

## Goal

**Single procedure modality inside the kernel:**

1. **Dictionary (`RULES` / schemas / algorithms)** = only place procedure **bodies** live.  
2. **Gates** = ordered **lists of `@refs`** (rules, schemas, algorithms, diagrams) — no freestyle step recipes.  
3. **Lookup protocol** (one line in Protocol):  
   `On gate @Gn: apply each entry under rules:/steps: by resolving @NAME to RULES / Algorithms / Schemas. Do not invent procedure from bare prose.`  
4. **Conformance tests** enforce: no bare rule ids on gates; no prose steps that restate RULES; every gate `@` resolves.

Token savings secondary; **correct retrieval path** primary.

---

## Prior art

| Source | Reuse |
|--------|--------|
| Mode-tail dialect | `# id — follow @SPEC` |
| `algorithm_routing:` | Already `@NOISE_FILTER`, `@CLASSIFICATION` |
| `RUNTIME_RULE_CATEGORIES` | Python maps rule → G1…G9 / CC |
| `RUNTIME_RULES` | Canonical bodies in `27_runtime_dict.py` |
| SPECS `See: @G1` | Back-refs from rules to gates |
| `NAMING` rule | UPPER_SNAKE rule ids; exact match only |

`reuse: make gates look like algorithm_routing + mode tails — refs only.`

---

## Target shape (examples)

### Gate (before — wrong)

```yaml
# DECOMPOSE (@G2)
  rules:
  - DECOMPOSE
  - FRACTAL_CANDIDATES
  - GOAL_SEEDS
  ...
  steps:
  - '2a: goal_seeds(goal, evidence) → keyword extraction → ...'
  - '2b: generate_fractal_candidates(model, seeds, depth) on chosen lattice'
  geometry:   # long formulas inlined
  ...
```

### Gate (after — right)

```yaml
# DECOMPOSE (@G2)
  rules: [@DECOMPOSE, @FRACTAL_CANDIDATES, @GOAL_SEEDS, @GOAL_PEAKS, @SV_DELTA, @METRIC_ADAPTATION]
  steps: [@GOAL_SEEDS, @FRACTAL_CANDIDATES, @DECOMPOSE]   # ordered apply chain
  geometry: @FRACTAL_GEOMETRY                              # or keep under schema only
  diagram: @FRACTAL_PIPELINE
  invariant: CENTRAL_TASKS=medoids only. No Mode-1.      # one-line hard invariant OK if not a RULE
```

### Protocol (add)

```text
Lookup: @RULE → RULES.@RULE body; @ALGO → Algorithms section; @SCHEMA → Schemas.
Gates declare refs only. Never re-author rule bodies in steps.
```

Bodies of `GOAL_SEEDS` / fractal formulas stay **once** under `RULES:` or `@FRACTAL_GEOMETRY`.

---

## Work packages

### WP0 — Audit artifact + tests (lock the bug)

- [ ] Check in a small audit script or pytest that fails when:
  - Gate `rules:` entry lacks `@` prefix  
  - Gate `steps:` line has no `@` and length > N (prose recipe)  
  - Gate `@X` not in `RUNTIME_RULES` ∪ algorithm tags ∪ schema tags ∪ `G1..G9`  
  - Bare `diagram: foo` instead of `@FOO`  
- [ ] Baseline: current mdc **fails** these tests (document counts from 2026-08-07 audit)

### WP1 — Protocol lookup line + naming

- [ ] Add **Lookup ABI** to `00_map.txt` / Protocol section (byte-stable, short)  
- [ ] Standardize all rule mentions as `@UPPER_SNAKE`  
- [ ] Document: bare names in gates are **bugs**

### WP2 — Rewrite gate fragments to ref-only

Source: `prompts_kernel/reasoning/` (assembled → mdc). Prefer editing sources that produce gates (schemas / `01_gates` / core_schemas), not hand-editing mdc.

- [ ] G1: `rules: [@EVIDENCE_ORDER, @SEARCH_ORDER, …]`; drop duplicate `search_intent` prose if already under `@G1` body or RULES — **or** keep intent table **only** under G1 and have `@SEARCH_ORDER` point to it (one home)  
- [ ] G2: delete prose steps; `steps: [@GOAL_SEEDS, @FRACTAL_CANDIDATES, @DECOMPOSE]`; move geometry to `@FRACTAL_GEOMETRY` only  
- [ ] G3–G4, G6–G9: same — `@` rules only  
- [ ] G5: attach rules (e.g. re-auth → `@WRITE_SCOPE` / back to `@G2` chain) or explicit `steps: [@G2, @G4]`  
- [ ] Cross-cutting RULES: attach to spine or `CC` block with `rules: [@MEMORY_RANK, …]` so they are not orphaned

### WP3 — Dictionary placement / density

Options (pick one in implementation):

| Option | Idea |
|--------|------|
| **A (preferred)** | Keep RULES at end (stable KV layout) but **gates are 100% `@`** so model must jump |
| **B** | Render RULES **before** gates (dictionary-first) |
| **C** | Split: short RULE index early; full bodies late |

Recommend **A** first (minimal layout churn) + lookup ABI. Evaluate B only if recall still fails.

- [ ] Choose A/B/C; implement  
- [ ] Ensure `See: @Gn` from RULES stays consistent with gate lists  

### WP4 — Algorithms & diagrams

- [ ] Gate `diagram:` → `@FRACTAL_PIPELINE` etc.  
- [ ] Algorithm bodies may keep formulas; they must be **entered only via `@`** from gates/routing  
- [ ] Align `algorithm_routing` keys with gate when needed (e.g. G2 → noise? optional)

### WP5 — Python kernel sync

- [ ] `RUNTIME_RULES` / `RUNTIME_RULE_CATEGORIES` remain canonical for dictionary **text**  
- [ ] Gate YAML/schema generation must emit `@` prefixes (if gates come from `core_schemas.yaml`)  
- [ ] Reassemble `reasoning_prompt.mdc` via `write_reasoning()`  
- [ ] README in `prompts_kernel/reasoning/` — fix stale paths (`reasoning.txt` → `reasoning_prompt.mdc`)

### WP6 — Conformance + smoke

- [ ] pytest: gate↔RULES bijection for listed rules; no prose steps; every `@` resolves  
- [ ] Optional: fragment unit tests before assemble  
- [ ] `_build.ps1` kernel self-test still green; binary still inlines mdc as **text** (separate build fix)

---

## Non-goals

- Rewriting all tool `.txt` parasites (other plan)  
- Changing gate **count** (still G1–G9) without explicit design  
- Moving SPECS/agent blocks (unless needed for order option B)  
- Host skills / AGENTS  

---

## Smoke Tests

### Baseline (Exact from audit 2026-08-07)

| Check | Actual [Exact] |
|-------|----------------|
| Gate rules bare (no `@`) | Yes — all G1–G9 listed rules |
| G2 steps `@` count | **0** (prose only) |
| Gate rules missing from RULES | **[]** (names match) |
| RULES not on any gate | 10 keys (MEMORY_*, READ_ENTIRE_FILE, …) |
| RULES line number | ~881 (after Algorithms) |
| G1 line | ~78 |

### Post-impl

| # | Command / check | Pass |
|---|-----------------|------|
| 1 | `python -m pytest prompts_kernel/tests/ -q -k gate_or_rule_or_ref` (new tests) | pass |
| 2 | Audit script: zero bare gate rules; zero prose steps without `@` | pass |
| 3 | Every gate `@RULE` ∈ `RUNTIME_RULES` | pass |
| 4 | Assembled mdc still has `GATED_WORKFLOW`, full RULES bodies once | pass |
| 5 | `write_reasoning()` + kernel pytest suite | pass |
| 6 | Compile still inlines mdc text (`GATED_WORKFLOW` in binary) | pass |

---

## Success metrics

| Metric | Target |
|--------|--------|
| Procedure submodalities **inside** kernel | **1** (dictionary + tagged algos/schemas) |
| Gate `rules:` / `steps:` | **100% `@` refs** |
| Prose step recipes that restate RULES | **0** |
| Orphan RULES with no gate/CC attachment | **0** (or explicit `CC` hang) |
| Model flow | Gate → resolve `@` → body (not invent from step prose) |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Stripping geometry from G2 loses visibility | Keep once under `@FRACTAL_GEOMETRY`; step only refs it |
| Lookup ABI ignored | Short, top-of-protocol; tests force `@` syntax |
| Assemble overwrites hand mdc | Always edit sources + `write_reasoning()` |
| KV cache churn when RULES move | Prefer option A (refs only, order stable) |

---

## Execution checklist

- [x] WP0 — conformance tests (`test_gate_dictionary_refs.py`)  
- [x] WP1 — Protocol lookup ABI in `00_map.txt`  
- [x] WP2 — Gates ref-only (G1–G9 + CC) in `core_schemas.yaml`  
- [x] WP3 — Dictionary placement: option A (RULES stay late; gates 100% `@`)  
- [x] WP4 — diagram/geometry `@` refs on gates  
- [x] WP5 — `write_reasoning()` → assembled mdc  
- [x] WP6 — `test_gate_dictionary_refs` 7 passed; schema tests green  

**Landed shape (G9 example):**

```yaml
rules: [@CLEAN_STATE, @SV_OUTPUT, @SV_EVERY_TURN, ...]
steps: [@EMIT_STATE, @CLEAN_STATE, @SV_EVERY_TURN, ...]
# resolve @SV_EVERY_TURN → RULES → @SV_FORMAT
```

---

## Related paths

```
prompts_kernel/reasoning/00_map.txt      Protocol, identities
prompts_kernel/reasoning/01_gates.txt    schema pull + algorithm_routing
prompts_kernel/core_schemas.yaml         gate bodies if schema-driven
prompts_kernel/27_runtime_dict.py        RULES dictionary
prompts_kernel/28_runtime_render.py      renders RULES into mdc
prompts_kernel/_assemble_prompts_kernel.py  assemble → reasoning_prompt.mdc
packages/opencode/src/session/prompt/reasoning_prompt.mdc  runtime artifact
```
)
