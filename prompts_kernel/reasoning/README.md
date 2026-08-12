# Reasoning protocol fragments

**Version**: v1.0 freeze candidate (2026-08-12). Baseline at `baseline/reasoning_prompt_v1.0.txt`.

**Lineage**: These fragments assemble into the thinking kernel — the **canonical runtime successor**
to the ADID Framework. The assembled kernel takes **highest priority** over any ADID-derived
artifacts (host rules, skill trees, receiver files). Conflict → kernel wins.

**Reasoning is a mode protocol** (gated spine + YAML schemas) — **host-agnostic process law**.

No host worktree paths, project AGENTS files, or host skill/rule trees belong in
these fragments (every project layout differs). Runtime injects host surfaces
for the current session. See kernel `21_skills_boundary.py`.

## Location

Source fragments live in `prompts_kernel/reasoning/*.txt`.
Assembly publishes to `prompts_kernel/dist/{date}_reasoning_prompt.mdc` + `.txt`
(review + runtime artifacts). Production promotion to
`packages/opencode/src/session/prompt/reasoning_prompt.txt` is **manual** —
only after deep analysis of the generated artifacts.

## Assembly

```bash
# Full build pipeline (kernel + reasoning + rust + opentui + opencode + stage):
python build.py

# Kernel-only (assemble fragments → dist/):
python -c "from prompts_kernel import write_reasoning; write_reasoning()"

# Precompile kernel (faster import):
python -c "from prompts_kernel import write_precompiled_kernel; write_precompiled_kernel()"
```

## Promotion workflow

1. **Assemble** — `write_reasoning()` → `prompts_kernel/dist/{date}_reasoning_prompt.mdc` + `.txt`
2. **Analyze** — review `.mdc` (with YAML frontmatter) for structural integrity:
   - Gate structure (G1→G9 spine intact)
   - Assembly point (`# Semantic Vector` H1 → `## SV_FORMAT (@SV_FORMAT)` H2)
   - Schema density (full YAML from `core_schemas.yaml`, not compressed)
   - No quality postscript after root-of-truth
3. **Verify** — run toolchain:
   ```bash
   python -m prompts_kernel.tools.refcheck
   python -m prompts_kernel.tools.dictionary --validate
   python -m pytest prompts_kernel/tests/ -q
   ```
4. **Promote** — ONLY after analysis passes:
   ```bash
   copy /Y prompts_kernel\dist\{date}_reasoning_prompt.txt packages\opencode\src\session\prompt\reasoning_prompt.txt
   ```
   Commit both `.mdc` (historical record) and `.txt` (production).

## Fragments (v7)

| Fragment | Lines | Role |
|----------|-------|------|
| `00_map.txt` | 71 | SV protocol + identity tables + gate dispatch + modes + agents |
| `00b_schemas.txt` | 34 | `@schema:` markers resolved against `core_schemas.yaml` at build time |
| `00c_algorithms.txt` | 108 | NOISE_FILTER, CLASSIFICATION, BUG_FIX_CHAIN, METRIC_GOVERNANCE, SV_TRAJECTORY, MULTI_AGENT_SV |
| `01_gates.txt` | 74 | Gates 1–9 with rules, schemas, invariants, algorithm routing |
| `05_epistemic.txt` | 41 | STATUS_SET, CLAIM_PROMOTION, ENFORCEMENT, ORACLE_CONCEPT |
| `06_hygiene.txt` | 8 | commit policy, code refs, secrets, invent/approach rules |

**Structure:** SV identity → schemas → algorithms → gates → epistemics → hygiene.
**Notation:** YAML blocks for formats; `@REF` for cross-references; `@schema:` markers for YAML injection.

## Constitution verification

Kernel constitution lives in `prompts_kernel/` Python specs:
- `24_specs_policies.py` — PLANNING (fractal_only, GROUNDED_PATH), GOVERNANCE (ExecutionEnvelope, evaluator capture, SELF_MODIFY triple-separation)
- `26_specs_grounding.py` — GROUNDING_RULES (SEARCH_ORDER, REUSE_BEFORE)
- `27_runtime_dict.py` — RUNTIME_RULES, RUNTIME_RULE_CATEGORIES, RUNTIME_TERMS, PROMPT_ABI
- `28_runtime_render.py` — renders runtime dictionary into kernel text

Run `python build.py && python -m pytest prompts_kernel/tests/ -q` before commit.

## InfoMark runtime

`claim_ledger` + `oracle_stamp` + `inference_stamp` govern epistemic state.
MODIFY tools blocked when `premises_for_plan ⊈ G` (G = system-stamped Exact ∪ Inferred).
Self-[Exact] without stamp is rejected by runtime.
