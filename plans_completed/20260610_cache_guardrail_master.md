# DeepSeek Cache Guardrail — Master Experiment Plan

Date: 2026-06-10  
Status: Master Plan (Phase details in sub-documents)

## Goal

Build a **predictive guardrail system** that detects cache-breaking conditions in outgoing requests BEFORE they are sent to DeepSeek, and either warns or restructures content to preserve cache continuity. This is not about saving API cost — it is about preserving the LLM's **precomputed reasoning state** for output quality.

## Why This Matters

DeepSeek's KV cache stores precomputed attention states on disk. When the cache chain is stable:
- The model reuses precomputed computations → lower latency
- The model builds on accumulated reasoning → higher output quality
- DeepSeek expends less compute → good for both parties

When the cache chain breaks:
- The model starts from token 0 → full re-computation
- All accumulated reasoning context is lost → lower output quality
- Higher latency, higher cost, wasted compute

## Predictive Model

We need a function that, given a candidate request, predicts:

```ts
function predictCacheHit(
  previousRequest: Request,    // last request sent
  candidateRequest: Request,   // request about to be sent
): CachePrediction {
  return {
    commonPrefixTokens: number,       // how many tokens will match
    divergencePoint: number,           // token index where divergence begins  
    divergenceReason: string,          // what caused the split
    estimatedHitRatio: number,         // 0.0 - 1.0
    outputQualityRisk: "low" | "medium" | "high",
    recommendations: string[],         // what to change to improve cache
  }
}
```

## Experiment Phases

### Phase 1: Cache Stability Baseline
**Sub-document**: `plans/20260610_phase1_baseline.md`

Measure the correlation between cache hit ratio and output quality.

- 20 test scenarios with varying cache hit ratios (0% to 95%)
- Measure: token generation speed, response coherence (MiniLM-v6), instruction compliance
- Statistical analysis: at what hit ratio does quality statistically degrade?
- **Deliverable**: Quality-vs-cache-hit curve, minimum viable hit ratio

### Phase 2: Prefix Divergence Detection
**Sub-document**: `plans/20260610_phase2_divergence.md`

Build the token-level prefix comparator. Given two `Request` objects, compute exactly where the prefix diverges.

- Tokenize requests using DeepSeek's tokenizer (or closest approximation)
- Compute Longest Common Prefix (LCP) at token level
- Classify divergence causes: date change, new message, modified part, section reorder
- **Deliverable**: `computeDivergence()` function + test suite with known divergence points

### Phase 3: Semantic Equivalence Detection
**Sub-document**: `plans/20260610_phase3_semantic.md`

Detect when content is semantically equivalent despite byte-level differences. This enables cache reuse for "close enough" content.

- MiniLM-v6 embeddings of each message/section
- Cosine similarity matrix between old and new content
- Threshold calibration: at what similarity score is content "close enough" to reuse cache?
- Test with compaction summaries: old summary vs new summary sections
- **Deliverable**: `isSemanticallyEquivalent()` function + calibrated threshold

### Phase 4: Guardrail Prototype
**Sub-document**: `plans/20260610_phase4_guardrail.md`

Build the full predictive guardrail as a TypeScript module.

- Integrate: prefix comparator (Phase 2) + semantic detector (Phase 3)
- Hook into `session/llm.ts` BEFORE the `streamText()` call
- Decision matrix: warn, restructure, or proceed based on predicted cache hit ratio
- Restructuring strategies: reorder messages, split into stable/dynamic, inject cache-friendly markers
- **Deliverable**: Working guardrail module with test coverage

### Phase 5: Compaction Integration
**Sub-document**: `plans/20260610_phase5_integration.md`

Apply the guardrail specifically to the compaction pipeline.

- Measure cache continuity across compaction cycles
- Detect when system prompt changes (date) would break cache → fix or warn
- Optimize compaction summary format for cache stability (fixed headers, consistent ordering)
- **Deliverable**: Compaction-specific guardrail configuration + integration tests

## Experiment Files

```
packages/opencode/test/experiments/20260610_cache_guardrail/
├── README.md                 # Experiment overview and run instructions
├── phase1_baseline.ts        # Cache-hit vs output quality measurement
├── phase2_divergence.ts      # Token-level prefix divergence detection
├── phase3_semantic.py        # MiniLM-v6 semantic equivalence detection
├── phase4_guardrail.ts       # Predictive guardrail prototype
├── phase5_integration.ts     # Compaction-specific guardrail
├── fixtures/
│   ├── stable_session.json   # Session with high cache stability
│   ├── volatile_session.json # Session with known cache breaks
│   └── expected_divergence.json # Known divergence points for testing
└── results/                  # Output (gitignored)
    ├── quality_curve.json
    ├── divergence_report.json
    ├── semantic_matrix.json
    └── guardrail_report.json
```

## Key Metrics

| Metric | Phase | Target |
|--------|-------|--------|
| Cache hit ratio vs output quality correlation | 1 | r > 0.7 |
| Prefix divergence prediction accuracy | 2 | 100% (deterministic) |
| Semantic equivalence detection F1 | 3 | F1 > 0.85 |
| Guardrail precision (correctly predicted breaks) | 4 | > 0.90 |
| Guardrail recall (caught all actual breaks) | 4 | > 0.85 |
| Compaction cycle cache continuity | 5 | > 80% of head tokens cached |

## Success Criteria

The guardrail system must:
1. Predict cache breaks BEFORE they happen (not reactive)
2. Provide actionable recommendations (not just warnings)
3. Never false-positive on stable requests (don't block valid requests)
4. Integrate into the existing `llm.ts` flow without architectural changes
5. Work with any DeepSeek model (not hardcoded to specific dimensions)

## References

- [DeepSeek Context Caching Docs](https://api-docs.deepseek.com/guides/kv_cache) — prefix unit rules, persistence behavior
- `packages/opencode/src/session/llm.ts` — system prompt assembly, cache compaction
- `packages/opencode/src/session/compaction.ts` — compaction pipeline
- `packages/opencode/src/session/system.ts` — environment/date/skills generation
