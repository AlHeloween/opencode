# Kernel Dictionary Semantic Map

**Goal**: Resolve @REF links to canonical dictionary definitions, compute embeddings per entry, all-pairs cosine similarity, output top-3 nearest neighbors per entry — feeding into semantic flow ordering of the kernel.

**Status**: plan | **Created**: 2026-08-07

---

## Premises (⊆ G)

| ID | Claim | Status |
|----|-------|--------|
| C1 | Dictionary = RULES(32) + TERMS(12) + Gates(9) + Schemas(16) + Algorithms(4) + Diagrams(10) + Identities + Epistemic + Hygiene sections in reasoning_prompt.txt | Exact |
| C2 | @REF resolution is currently model-inference-only — no programmatic body resolver exists | Exact |
| C3 | `refcheck.py` validates @REF→anchor existence but doesn't extract bodies | Exact |
| C4 | `refgraph.py` builds BFS traversal graph but doesn't resolve body text | Exact |
| C5 | `27_runtime_dict.py` is canonical source for RULES + TERMS + PROMPT_ABI; `reasoning/*.txt` fragments + `core_schemas.yaml` for gates/schemas | Exact |
| C6 | `src/attachment/embedding.ts` has `cosineSimilarity()` — reusable signature but scoped to attachments | Exact |
| C7 | Planned BGE dedup in `prompts_kernel/tools/README.md:42-51` is unimplemented | Exact |
| C8 | `@INSTITUTIONAL_SOURCES` was a generation artifact — removed from `universalsearch.txt` | Exact |

## Open Questions

| ID | Question |
|----|----------|
| Q1 | ~~Resolution depth~~ → **RESOLVED: full DeepResolution**. Transitive closure — every @REF recursively expanded to its full body. Cycle detection prevents infinite loops. This captures the complete semantic footprint of each entry, enabling maximum-adjacency-similarity flow sorting. |
| Q2 | Embedding model: BGE v1.5 (local, fast), OpenAI text-embedding-3-small (API), or reuse TS infrastructure? |
| Q3 | Output format: console table, JSON, YAML, or visual graph (Mermaid/D3)? |
| Q4 | Threshold for "semantically close": fixed (e.g., cosine > 0.7) or adaptive (top-k)? |

---

## Goals

### G1: Dictionary Extractor
**SV**: dictionary, extraction, parsing, reasoning_prompt, symbol_table

Parse `reasoning_prompt.txt` into a flat symbol table of all dictionary entries. Each entry has: canonical ID, type (rule|schema|algorithm|diagram|gate|term|identity|epistemic), raw body text, source line range, and list of @REFs it contains.

**Tasks**:

- [ ] **T1.1**: Implement `parse_dictionary(kernel_path) → dict[str, Entry]`
  - File: `prompts_kernel/tools/dictionary.py`
  - What: Parse reasoning_prompt.txt section-by-section, extract all entries with type classification
  - Oracle: `python -m prompts_kernel.tools.dictionary --validate` returns entry count == expected (32 rules + 12 terms + 9 gates + 16 schemas + 4 algorithms + 10 diagrams + ...)

- [ ] **T1.2**: Classify each entry by type
  - What: Rules detected by `## RULES` section + YAML key pattern; Gates by `# GROUND (@G1)` pattern; Schemas by `## NAME (@NAME)` in Schemas section; etc.
  - Oracle: Every entry has a non-null `type` field

- [ ] **T1.3**: Extract @REF references from each entry body
  - What: Run `REF_PAT` regex on each body, store list of outgoing @REFs
  - Oracle: Entry `DECOMPOSE` has `@G2, @FRACTAL_GEOMETRY` in its out_refs list

### G2: @REF Resolver — Full DeepResolution
**SV**: transitive_closure, recursive_resolution, cycle_detection, semantic_footprint

Resolve @REF links to their **full transitive closure**: every `@REF_NAME` is recursively expanded to the complete body text of the referenced entry. The resolved body for each entry = its own raw body + all transitively reachable bodies (deduplicated). This captures the entry's full semantic footprint — what it directly states PLUS everything it depends on.

**Why full transitive closure matters for flow sorting**: Two entries that share deep transitive dependencies (e.g., both eventually reference `@G8`, `@FRACTAL_GEOMETRY`) will have similar resolved bodies → their embeddings will be close → they'll be adjacent in the flow order. This is exactly what "maximum adjacency similarity" requires.

**Tasks**:

- [ ] **T2.1**: Implement `resolve_transitive(entry_id, symbol_table, visited=None) → str`
  - What: Recursively expand every `@REF_NAME` in the entry's body to the full body of REF_NAME. Continue expanding @REFs within those bodies. Track `visited` set to detect cycles — on cycle, inline the referenced entry's **name only** (not body) to break recursion.
  - Algorithm: DFS with visited set. For each @REF found: if ref in visited → emit `{REF_NAME}` (cycle-safe); else → recurse into ref's body, add to visited, append result.
  - Example: `DECOMPOSE` body resolves to include: its own text + FRACTAL_GEOMETRY full body + G2 full body + GOAL_SEEDS body + ... (transitively everything in the DECOMPOSE→... subgraph)
  - Oracle: `DECOMPOSE` resolved body contains "Manhattan L1: d₁(c,g)=Σₖ|w_c(k)−w_g(k)|" (from FRACTAL_GEOMETRY) AND "Fractal lattice before work list" (from G2) AND "goal_seeds(goal, evidence) extracts meaning-true goal slices" (from GOAL_SEEDS)

- [ ] **T2.2**: Handle edge cases
  - What: Self-references (A→A: inline name once, stop), mutual references (A→B→A: A gets B's body, B gets A's name tag), missing refs (log warning, leave @REF as-is), entries with no refs (body unchanged)
  - Oracle: 0 infinite loops; 0 unresolved refs (after @INSTITUTIONAL_SOURCES fix); every entry produces a finite resolved body

- [ ] **T2.3**: Size guard
  - What: If resolved body exceeds 50KB, truncate with marker `[... truncated at 50KB]`. Embedding models have token limits.
  - Oracle: All resolved bodies ≤ 50KB

### G3: Embedding Pipeline
**SV**: embedding, BGE, vector, model, numeric

Compute embedding vector for each resolved dictionary entry. Store vectors alongside entry metadata.

**Tasks**:

- [ ] **T3.1**: Choose embedding model
  - What: BGE v1.5 via `sentence-transformers` (local) OR OpenAI `text-embedding-3-small` (API). BGE preferred for build-time reproducibility.
  - Oracle: `pip install sentence-transformers` succeeds; model loads in < 30s

- [ ] **T3.2**: Implement `compute_embeddings(entries) → dict[str, np.ndarray]`
  - File: `prompts_kernel/tools/embed.py`
  - What: Batch-encode all resolved entry bodies. Cache to disk (`.embeddings_cache/`) keyed by (model, body_hash).
  - Oracle: All entries have a vector of dimension 768 (BGE) or 1536 (OpenAI)

- [ ] **T3.3**: Handle embedding failures
  - What: Entries whose body is too short (< 10 chars) or encoding fails → zero vector + warning
  - Oracle: No unhandled exceptions; all entries have a vector

### G4: Similarity Matrix + Top-K
**SV**: cosine, similarity, matrix, neighbors, ranking

All-pairs cosine similarity. For each entry, output top-3 nearest neighbors with similarity scores.

**Tasks**:

- [ ] **T4.1**: Implement `compute_similarity_matrix(vectors) → ndarray`
  - What: N×N cosine similarity matrix. Normalize vectors first, then dot product = cosine.
  - Oracle: Matrix is symmetric, diagonal = 1.0, shape = N×N

- [ ] **T4.2**: Implement `top_k_neighbors(matrix, k=3) → dict[str, list[tuple[str, float]]]`
  - What: For each entry, exclude self (diagonal), sort by similarity descending, take top-k.
  - Oracle: Each entry has exactly 3 neighbors; no entry lists itself

- [ ] **T4.3**: Output formatting
  - File: `prompts_kernel/tools/semantic_map.py` (main entry point)
  - What: Console table + JSON output. Format: `ENTRY_ID → [(NEIGHBOR_1, 0.92), (NEIGHBOR_2, 0.87), (NEIGHBOR_3, 0.81)]`
  - Oracle: `python -m prompts_kernel.tools.semantic_map` prints formatted table and writes `kernel_semantic_map.json`

### G5: Flow Sorting — Maximum Adjacency Similarity
**SV**: flow, ordering, TSP, adjacency, Hamiltonian_path, optimization

Given the cosine similarity matrix from G4, find an ordering of dictionary entries that **maximizes the sum of similarities between adjacent entries**. This is the Maximum Adjacency Similarity (MAS) problem — equivalent to finding a maximum-weight Hamiltonian path in a complete graph where nodes are entries and edge weights are cosine similarities.

**Tasks**:

- [ ] **T5.1**: Implement greedy flow ordering
  - What: Starting from a seed entry, repeatedly add the highest-similarity unvisited neighbor (nearest-neighbor chain). This produces a Hamiltonian path through the dictionary.
  - Oracle: Every entry appears exactly once in the flow order

- [ ] **T5.2**: Cluster analysis
  - What: Run agglomerative clustering on cosine distance matrix. Identify natural clusters (e.g., "oracle-related", "evidence-related", "mutation-related"). Compare with existing `RUNTIME_RULE_CATEGORIES`/`RUNTIME_RULE_OWNERS`.
  - Oracle: Clusters align with existing owner categories within ±2 rules

- [ ] **T5.3**: Report misalignments
  - What: Flag entries whose top-3 semantic neighbors are NOT in the same existing category. These are candidates for reorganization.
  - Oracle: Report lists `{entry, current_category, nearest_neighbor_category, similarity}`

---

## Architecture

```
prompts_kernel/tools/
├── refcheck.py          # existing — @REF existence validation
├── refgraph.py          # existing — BFS reference graph
├── dictionary.py        # NEW — parse kernel → symbol table
├── embed.py             # NEW — compute embeddings via BGE
├── semantic_map.py      # NEW — main: resolve → embed → similarity → top-k → flow
└── README.md            # update — document new tools

Data flow:
  reasoning_prompt.txt
       │
       ▼ dictionary.py
  [Entry{id, type, body, refs}]  ──→  transitive closure (full DeepResolution)
       │                                    │
       │                                    ▼ embed.py
       │                              [vectors: dict[id→ndarray]]
       │                                    │
       │                                    ▼ semantic_map.py
       │                              cosine_matrix → top_k → flow_order
       │                                    │
       ▼                                    ▼
  kernel_semantic_map.json          console report
```

## Embedding Model Decision

| Model | Dim | Speed | Quality | Setup |
|-------|-----|-------|---------|-------|
| BGE-small-en-v1.5 | 384 | ~1000 entries/s | Good for short text | `pip install sentence-transformers` |
| BGE-base-en-v1.5 | 768 | ~300 entries/s | Better | `pip install sentence-transformers` |
| OpenAI text-embedding-3-small | 1536 | API-limited | Best | API key required |

**Recommendation**: BGE-base-en-v1.5 for build-time reproducibility, no API dependency, and alignment with the planned dedup in README.

## Key Design Decisions

1. **Full DeepResolution — transitive closure** (Q1 resolved): `@FRACTAL_GEOMETRY` → full body of FRACTAL_GEOMETRY → recursively expand all @REFs within that body → continue until full transitive closure is captured or cycles are hit. The resolved body for each entry represents its complete semantic footprint. This is what enables maximum-adjacency-similarity flow sorting: entries with overlapping transitive dependencies will have similar embeddings and cluster together naturally.

2. **Python, not TypeScript**: Build-time analysis belongs in the `prompts_kernel/` pipeline alongside `refcheck.py` and `refgraph.py`. The TS embedding infrastructure is runtime-only and scoped to attachments.

3. **Cache embeddings**: Keyed by (model_name, sha256(body)). Re-compute only when kernel text changes.

4. **Output as JSON for programmatic consumption + console table for human review**: Enables CI integration and downstream flow optimization tools.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| BGE model download fails in CI | Fallback to mock/stub for CI; real run is developer-local |
| Transitive closure inflates body text (DECOMPOSE may pull in 10+ transitive deps = 5-10KB) | 50KB hard cap per resolved body. If exceeded, truncate with marker. This is rare — only entries at the root of deep reference trees hit this. The inflation is semantic signal, not noise — it captures genuine dependency structure. |
| Circular @REF resolution | DFS visited set per resolution — on cycle, emit `{NAME}` tag instead of body, breaking recursion. Every resolved body is finite. |
| Kernel changes between embedding and analysis | Embedding cache keyed by content hash → auto-invalidates |

---

## Dependencies

- `prompts_kernel/tools/refcheck.py` — reuse `extract_refs()`, `extract_anchors()`
- `prompts_kernel/tools/refgraph.py` — reuse `parse()` section splitter
- `27_runtime_dict.py` — cross-reference RUNTIME_RULE_CATEGORIES for cluster validation
- `sentence-transformers` (pip) — BGE model
- `numpy` (pip) — vector math
- `scipy` (pip, optional) — `cosine` distance for validation
