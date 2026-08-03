# Reasoning protocol fragments

**Reasoning is a mode protocol** (gated spine + YAML schemas) — **host-agnostic process law**.

No host worktree paths, project AGENTS files, or host skill/rule trees belong in
these fragments (every project layout differs). Runtime injects host surfaces
for the current session. See kernel `21_skills_boundary.py`.

## Location

Source fragments live in `prompts_kernel/reasoning/*.txt`.
Assembled output writes to `packages/opencode/src/session/prompt/reasoning.txt`
(loaded by `ProviderTransform.systemPromptParts`).

## Assembly

```bash
python -c "from prompts_kernel import assemble_reasoning, write_reasoning; write_reasoning()"
```

Or via the full build pipeline:

```bash
python build.py
```

## Fragments (v6)

| Fragment | Role |
|----------|------|
| `00_map.txt` | Identity + mandatory spine (anti-skip), mermaid 9-gate flow with envelope branch |
| `01_gates.txt` | Gates 1–9 + YAML schemas: action_class (v6: MODIFY_CANDIDATE/PROMOTE_STABLE/SELF_MODIFY), master_plan, claim_ledger, explorer_goal, oracle, oracle_stamp, inference_stamp, clean_next_state, sv_output, blocker |
| `02_algorithms.txt` | SVM signal cluster (COLLAPSED_DUPLICATES, not filter), classify, bug_fix chain, adaptive_depth (evidence_coverage, not evidence_count) |
| `03_infomark_oracles.txt` | Claim law, EpistemicStatus enum, oracle interaction, InfoMark separations |
| `04_hygiene.txt` | Shared behavior, secrets, workspace lanes, compaction annex |

**Structure:** spine first, YAML schemas, algorithms, annex last.
**Notation:** Mermaid process graphs; LaTeX for math.

## v6 Key changes

- **action_class**: `MODIFY_CANDIDATE`, `MODIFY_PROJECT`, `PROMOTE_STABLE`, `SELF_MODIFY` activities; `CRITICAL` risk level
- **Gate 4**: envelope resolver — `APPROVED_BY_ENVELOPE` for MODIFY_CANDIDATE within scope; explicit approval for PROMOTE_STABLE/SELF_MODIFY
- **inference_stamp**: derivation-validated system stamp for Inferred claims entering grounding set G
- **adaptive_depth**: `evidence_coverage` (0–1) modulates depth — high coverage → shallower lattice (territory mapped), NOT `evidence_count > 10 → depth=3`
- **NOISE → COLLAPSED_DUPLICATES**: cardinality + unique_locations preserved; representative signal remains ACTIVE
- **METRIC_ADAPTATION**: PARAMETER_ADAPTATION (auto within bounds) vs METRIC_FAMILY_CHANGE (candidate branch + holdout + promotion)
- **TERMINAL state**: empty residual → agent transitions to TERMINAL; discarded tasks → out_of_scope

## Constitution verification

Kernel constitution lives in `prompts_kernel/` Python specs:
- `24_specs_policies.py` — PLANNING (fractal_only, GROUNDED_PATH), GOVERNANCE (ExecutionEnvelope, evaluator capture, SELF_MODIFY triple-separation)
- `26_specs_grounding.py` — GROUNDING_RULES (SEARCH_ORDER, REUSE_BEFORE, evidence_coverage)
- `27_runtime_dict.py` — RUNTIME_RULES, RUNTIME_WORKFLOWS, RUNTIME_CONTRACTS, PROMPT_ABI v6
- `28_runtime_render.py` — renders prompts_kernel.txt + algorithm_card.txt from specs

Cross-artifact consistency: `prompts_kernel.txt`, `algorithm_card.txt`, `reasoning.txt` must all agree.
Build-time test `test_runtime_kernel_artifact_matches_generator` catches drift.
Run `python build.py && cd prompts_kernel && python -m pytest tests/ -q` before commit.

## InfoMark runtime

`claim_ledger` + `oracle_stamp` + `inference_stamp` govern epistemic state.
MODIFY tools blocked when `premises_for_plan ⊈ G` (G = system-stamped Exact ∪ Inferred).
Self-[Exact] without stamp is rejected by runtime.
