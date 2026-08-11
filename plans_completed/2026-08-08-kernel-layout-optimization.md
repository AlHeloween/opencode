# Kernel Layout Optimization — Semantic Reordering

**Goal**: Restructure `reasoning_prompt.txt` section order to minimize semantic delta (currently 37.14) by fixing misplaced entries, consolidating gate clusters, and removing duplicates — verified by BGE embedding re-analysis.

**Status**: plan | **Created**: 2026-08-08

---

## Premises (⊆ G)

| ID | Claim | Status | Evidence |
|----|-------|--------|----------|
| C1 | BGE embedding analysis of 94 kernel entries reveals semantic structure consistent with ADID gates | Exact | `kernel_semantic_map.json` — best chain delta=37.14, gates at correct logical positions |
| C2 | G9 is isolated: cluster of 1 element. CLEAN_STATE, PLANS_COMPLETED, SV_EVERY_TURN, RESIDUAL_LOOP, EMIT_STATE scattered across G5-G8 instead of near G9 | Exact | Chain positions: CLEAN_STATE@33, PLANS_COMPLETED@35, RESIDUAL_LOOP@82, EMIT_STATE@88, SV_DELTA@89 — all far from G9@93 |
| C3 | G1 rules (GROUND, SEARCH_ORDER, VCS_ROOT, NO_HARDCODE, READ_ENTIRE_FILE, EVIDENCE_ORDER, WHERE_WHICH, NOISE_FILTER, SIGNAL_CLUSTER) are scattered: GROUND@37, VCS_ROOT@92, NO_HARDCODE@38, READ_ENTIRE_FILE@36 — far from G1@0 | Exact | Chain positions extracted from `kernel_semantic_map.json` |
| C4 | @CC cross-cutting rules (TONE_AND_STYLE, NAMING, DOCUMENT_SURFACE, WORKSPACE_LANES, PROGRESS_LOG, MEMORY_RANK, MEMORY_LINKS, ADID_FREEZE) and terms (hygiene, memory, evidence, scope, cache, adid, mutation, verification, oracle, style) are interleaved with gate-specific content | Exact | style appears at positions 11 and 79; terms scattered throughout |
| C5 | Semantic duplicates detected: CLAIM_PROMOTION_DIAGRAM ≅ EPISTEMIC_LADDER (cos=0.9562), METRIC_ADAPTATION ≅ METRIC_GOVERNANCE (cos=0.9299) | Exact | Top-3 neighbor analysis from `kernel_semantic_map.json` |
| C6 | G6→G7 transition is polluted: G9 elements (CLEAN_STATE, PLANS_COMPLETED) and G1 rules (GROUND, READ_ENTIRE_FILE, NO_HARDCODE, DOCUMENT_SURFACE) sit between G6@32 and G7@40 | Exact | Chain positions 33-39 |
| C7 | G1 nearest neighbors are G6(0.833), G9(0.774), G8(0.759) — NOT G2. G1 semantically drifts to distant gates | Exact | Key neighbors from `kernel_analysis_summary.txt` |
| C8 | `reasoning_prompt.txt` is the canonical assembled kernel (1324 lines). Section order determines the "spine" that gates + dictionary entries follow | Exact | File read — sections: Semantic Vector → Protocol → Identities → Gates → Diagrams → Schemas → Algorithms → Epistemic → Hygiene → RULES |
| C9 | Tooling exists: `dictionary.py` (parser), `embed.py` (BGE), `semantic_map.py` (matrix + chains + gated flow) | Exact | All files committed in `prompts_kernel/tools/` |

---

## Goals

### G1: Consolidate G9 Terminal Block
**SV**: G9, terminal, cleanup, state, emission, cluster

Move all G9-semantic entries adjacent to G9 gate. Currently scattered across G5-G8.

**Tasks**:

- [ ] **T1.1**: Identify G9 entries: CLEAN_STATE, PLANS_COMPLETED, SV_EVERY_TURN, SV_OUTPUT, SV_FORMAT, RESIDUAL_LOOP, EMIT_STATE, CLEAN_NEXT_STATE, BLOCKER, MSG_TAG, SV_DELTA
  - Files: `reasoning_prompt.txt` — locate each entry's current position
  - Oracle: `python -m prompts_kernel.tools.dictionary --resolve G9` shows all G9 rules

- [ ] **T1.2**: Move G9 entries to a contiguous block after G9 gate in reasoning_prompt.txt
  - What: Reorder sections so G9 rules/schemas follow G9 gate immediately
  - Oracle: Re-run `semantic_map.py --gated G1..G9` — G9 cluster >1 entry, delta reduced

### G2: Extract @CC Cross-Cutting Block
**SV**: cross_cutting, tail, style, hygiene, memory, terminology

Collect all @CC rules and generic terms into a dedicated tail section, removing them from gate-specific clusters.

**Tasks**:

- [ ] **T2.1**: Identify @CC entries: TONE_AND_STYLE, NAMING, DOCUMENT_SURFACE, WORKSPACE_LANES, PROGRESS_LOG, MEMORY_RANK, MEMORY_LINKS, ADID_FREEZE + terms: hygiene, memory, evidence, scope, cache, adid, mutation, verification, oracle, style, infomark, plan
  - Oracle: All identified entries have category="CC" or type="term"

- [ ] **T2.2**: Move @CC rules and terms to a dedicated `## Cross-Cutting (@CC_TAIL)` section at end of reasoning_prompt.txt (before RULES/Tier B)
  - What: Consolidate cross-cutting concerns in one place
  - Oracle: style appears only once in chain (not twice); delta reduced

### G3: Reunite G1 Grounding Rules
**SV**: G1, grounding, evidence, search, discovery

Pull all G1-category rules back to the G1 gate vicinity.

**Tasks**:

- [ ] **T3.1**: Identify G1 rules: GROUND, SEARCH_ORDER, EVIDENCE_ORDER, WHERE_WHICH, REUSE_BEFORE, NO_HARDCODE, VCS_ROOT, READ_ENTIRE_FILE, NOISE_FILTER, SIGNAL_CLUSTER + diagrams: NOISE_FILTER_DIAGRAM, SPINE_OVERVIEW, GROUND_PHASES, EPISTEMIC_LADDER
  - Oracle: All have category="G1" or are G1-related schemas/diagrams

- [ ] **T3.2**: Reorder G1 block so G1 gate is followed by its rules, then diagrams
  - What: G1 → GROUND → SEARCH_ORDER → EVIDENCE_ORDER → WHERE_WHICH → REUSE_BEFORE → NO_HARDCODE → VCS_ROOT → READ_ENTIRE_FILE → NOISE_FILTER → SIGNAL_CLUSTER → diagrams
  - Oracle: G1 top-3 neighbors after reorder include G2 (not G6/G9)

### G4: Remove Semantic Duplicates
**SV**: deduplication, merge, consistency, single_source

Merge or remove entries that encode the same semantic content.

**Tasks**:

- [ ] **T4.1**: Merge CLAIM_PROMOTION_DIAGRAM into EPISTEMIC_LADDER (cos=0.956)
  - What: Keep EPISTEMIC_LADDER (text + mermaid), remove standalone diagram
  - Oracle: `python -m prompts_kernel.tools.dictionary --validate` shows -1 diagram count

- [ ] **T4.2**: Merge METRIC_ADAPTATION rule into METRIC_GOVERNANCE algorithm (cos=0.930)
  - What: Keep METRIC_GOVERNANCE (algorithm + diagram), inline ADAPTATION text as subsection
  - Oracle: `python -m prompts_kernel.tools.dictionary --validate` shows -1 rule count, rule text preserved in METRIC_GOVERNANCE body

### G5: Heal G6→G7 Transition
**SV**: transition, continuity, adjacency, spine

Clean the semantic gap between G6 and G7 by removing misplaced entries.

**Tasks**:

- [ ] **T5.1**: Remove G9-leakage from G6→G7 gap (CLEAN_STATE, PLANS_COMPLETED → moved to G9 block)
  - What: Already done in T1.1
  - Oracle: Positions 33-35 in chain now contain G6-appropriate entries

- [ ] **T5.2**: Remove G1-drift from G6→G7 gap (GROUND, READ_ENTIRE_FILE, NO_HARDCODE, DOCUMENT_SURFACE → moved to G1/@CC blocks)
  - What: Already done in T3.1, T2.1
  - Oracle: G6→G7 transition contains only G6/G7 entries

---

## Smoke Specification

### SMOKE_BEFORE

| Label | Command | Expected exit |
|-------|---------|---------------|
| Dictionary validate | `python -m prompts_kernel.tools.dictionary --validate` | 0 (Valid: True) |
| Semantic baseline | `python -m prompts_kernel.tools.semantic_map --dictionary-only --gated G1,G2,G3,G4,G5,G6,G7,G8,G9 --json > kernel_semantic_map_before.json` | 0, records baseline delta |

### POST_CHECKS

| Label | Command | Expected |
|-------|---------|----------|
| Dictionary still valid | `python -m prompts_kernel.tools.dictionary --validate` | Valid: True |
| Delta reduced | Compare `kernel_semantic_map_after.json` best chain delta vs baseline | Δ < 37.14 |
| G9 cluster >1 | `python -c "import json; d=json.load(open('kernel_semantic_map_after.json')); ..."` | G9 has ≥5 adjacent entries |
| G1→G2 connected | Check G1 top-3 neighbors | G2 appears in G1's top-3 |
| No duplicates | Check cosine matrix for pairs >0.95 | No pairs >0.95 remain |
| G6→G7 clean | Chain positions between G6 and G7 | Only G6/G7 entries present |

### Blast Radius

- `reasoning_prompt.txt` — section reordering only (no content changes except T4 merges)
- `reasoning_prompt.mdc` — must be kept in sync
- All `.txt` tool files — unaffected
- `27_runtime_dict.py` — unaffected (RULES dictionary is flat, order-independent)
- Tests: `test_gate_dictionary_refs.py` — may need anchor position updates

---

## Implementation Order

1. **T4**: Remove duplicates first (reduces N, simplifies remaining moves)
2. **T2**: Extract @CC tail (clears noise from gate clusters)
3. **T1**: Consolidate G9 block (terminal coherence)
4. **T3**: Reunite G1 rules (grounding coherence)
5. **T5**: Verify G6→G7 transition healed (should be natural after 1-4)

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Section reordering breaks @REF resolution | All @REFs are by name, not position — order-independent. Validate with `refcheck.py` |
| `.mdc` / `.txt` desync | Copy `.txt` → `.mdc` after all edits, verify digest |
| Moving content changes semantic meaning of entries | Only section order changes; entry bodies preserved verbatim (except T4 merges) |
| Delta doesn't improve | Re-run with alternative gated chain candidates; if no improvement, revert |
