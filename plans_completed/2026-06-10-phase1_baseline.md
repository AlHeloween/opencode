# Phase 1: Cache Stability Baseline

Date: 2026-06-10  
Master Plan: `plans/20260610_cache_guardrail_master.md`  
Status: Plan

## Goal

Measure the quantitative correlation between DeepSeek cache hit ratio and output quality. Establish the minimum viable cache hit ratio below which output quality statistically degrades.

## Hypothesis

When the KV cache chain is maintained (high hit ratio), the model reuses precomputed attention states → responses are more coherent, better structured, and more accurate. When the chain breaks (low hit ratio), the model recomputes from scratch → quality degrades even with identical input.

## Method

### Test scenarios (20 variants)

Each scenario uses the **same system prompt + same conversation prefix** but varies the **suffix** (user question) to produce different cache hit ratios:

| Scenario | Prefix tokens | Suffix tokens | Expected hit ratio |
|----------|--------------|---------------|-------------------|
| S01 | 0 | 500 | 0% (no prefix) |
| S02 | 50 | 500 | ~10% |
| S03 | 100 | 500 | ~17% |
| S04 | 200 | 500 | ~29% |
| S05 | 300 | 500 | ~38% |
| S06 | 400 | 500 | ~44% |
| S07 | 500 | 500 | 50% |
| S08 | 600 | 400 | 60% |
| S09 | 700 | 300 | 70% |
| S10 | 800 | 200 | 80% |
| S11 | 900 | 100 | 90% |
| S12 | 950 | 50 | 95% |
| S13 | 200 | 200 | 50% (short) |
| S14 | 2000 | 500 | 80% (long prefix) |
| S15 | 5000 | 500 | 91% (very long prefix) |
| S16 | 500 | 500 | 50% (date differs — divergence at date token) |
| S17 | 500 | 500 | 50% (system prompt differs — divergence at prompt) |
| S18 | 500 | 500 | 50% (section reordered in prefix) |
| S19 | 500 | 500 | 50% (fact reworded but semantically same) |
| S20 | 500 | 500 | 50% (fact changed — genuinely different content) |

### Quality metrics (per response)

| Metric | Measurement | Tool |
|--------|------------|------|
| Coherence | Cosine similarity of response to expected structure | MiniLM-v6 |
| Instruction compliance | Does response follow the requested format? | Regex + structural checks |
| Factual consistency | Are facts from the prefix preserved? | NER + fact extraction |
| Token generation speed | Tokens per second (proxy for computation reuse) | API timing |
| Response length | Total output tokens | API response |

### Procedure

1. For each scenario, send a "warm-up" request to establish the cache
2. Wait 5s for cache persistence (per DeepSeek docs)
3. Send the test request
4. Record `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, response text, timing
5. Repeat each scenario 3 times to account for variance
6. Compute quality metrics on each response

### Analysis

- **Primary**: Pearson correlation between `hit_ratio` and each quality metric
- **Secondary**: ANOVA comparing quality across hit ratio bins (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
- **Threshold detection**: ROC analysis to find the hit ratio at which quality significantly degrades
- **Outlier analysis**: Scenarios 16-20 test specific divergence causes — identify which cause most quality degradation

## Deliverable

**Script**: `phase1_baseline.ts`

Output (JSON):
```json
{
  "scenarios": [
    {
      "id": "S01",
      "prefix_tokens": 0,
      "suffix_tokens": 500,
      "runs": [
        {
          "hit_tokens": 0,
          "miss_tokens": 500,
          "hit_ratio": 0.0,
          "tokens_per_second": 45.2,
          "coherence_score": 0.72,
          "instruction_compliance": 0.85,
          "response_length": 234
        }
      ],
      "avg_hit_ratio": 0.0,
      "avg_quality": 0.72
    }
  ],
  "correlation": {
    "coherence_vs_hit_ratio": 0.78,
    "speed_vs_hit_ratio": 0.91,
    "compliance_vs_hit_ratio": 0.65
  },
  "min_viable_hit_ratio": 0.50
}
```

**Report**: Quality-vs-cache-hit curve with statistical significance annotations.

## Dependencies

- DeepSeek API key (from `auth.json`)
- `deepseek-sdk` or direct fetch for API calls
- TypeScript run via `bun`
