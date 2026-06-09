# DeepSeek Cache Guardrail — Experiments

Master Plan: `plans/20260610_cache_guardrail_master.md`

## Purpose
Build a predictive guardrail system that detects cache-breaking conditions in outgoing requests BEFORE they are sent to DeepSeek. The guardrail preserves the LLM's precomputed reasoning state — preventing the model from starting from scratch when the cache chain breaks.

## Phases

| Phase | Script | Status | Tests |
|-------|--------|--------|-------|
| 1: Baseline | `phase1_baseline.ts` | Not started | TBD |
| 2: Divergence | `phase2_divergence.ts` | DONE | 18/18 pass |
| 3: Semantic | `phase3_semantic.py` | DONE | Manual verification |
| 4: Guardrail | `phase4_guardrail.ts` | DONE | 6 smoke scenarios |
| 5: Integration | `phase5_integration.ts` | Not started | TBD |

## Quick Start
```bash
cd packages/opencode

# Phase 2: Deterministic LCP detection (no API key needed, 18 tests)
bun test test/experiments/20260610_cache_guardrail/phase2_divergence.test.ts

# Phase 3: Semantic equivalence (needs Python + sentence-transformers)
pip install sentence-transformers torch numpy scipy
python test/experiments/20260610_cache_guardrail/phase3_semantic.py

# Phase 4: Guardrail decision matrix (smoke test, no API key)
bun run test/experiments/20260610_cache_guardrail/phase4_guardrail.ts

# Phase 4 guardrail demo with divergence detection
bun run test/experiments/20260610_cache_guardrail/phase2_divergence.ts
```

## Core Functions

| Function | Phase | Description |
|----------|-------|-------------|
| `computeDivergence(prev, next)` | 2 | Token-level LCP + cause classification |
| `guardrailCheck(prev, next, cfg)` | 4 | Full guardrail: predict + recommend |
| `restructureRequest(req, action)` | 4 | Apply cache-friendly restructurings |
| `semantic_similarity(a, b)` | 3 | MiniLM-v6 cosine similarity |
| `classify_fact_change(old, new)` | 3 | Semantic fact matching + categories |

## Key Findings

1. **Date in system prompt is a poison pill**: The dynamic `"Today's date: {date}"` in `system[2]` creates a divergence point that invalidates ALL subsequent cache (including conversation messages). The guardrail detects this and can restructure to remove the date.

2. **Semantic equivalence ≠ cache hit**: Two strings can be semantically identical (cosine similarity > 0.85) but produce different tokens → cache miss. Semantic detection informs warnings but can't fix byte-level cache divergence.

3. **Prefix-based cache is fragile**: DeepSeek matches token-by-token from the start. Any divergence at any position kills cache for everything after. The guardrail helps maintain long stable prefixes.
