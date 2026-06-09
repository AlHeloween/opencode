# DeepSeek Cache Semantics Research

Date: 2026-06-10  
Scope: Full cache behavior analysis across 7 experiments  
Status: Complete

## Experiments Run

| Test | Hypothesis | Result |
|------|-----------|--------|
| Phase 1 Date-in-system | Date in system prompt kills cache | CONFIRMED: 128→0 hits |
| Phase 1 Date-in-user | Date in user message kills cache | CONFIRMED: 256→0 hits |
| Phase 1 Fixed-width | Fixed-width date preserves cache | DISPROVED: position doesn't matter, token value does |
| Phase 1 Cold-vs-warm | Cache reduces latency | CONFIRMED: 20% faster (155→123ms) |
| Phase 1 Multi-unit | Multiple prefix units coexist | CONFIRMED: old units survive new insertions |
| Phase 1 Common-prefix | Common prefix detected after 1-2 requests | CONFIRMED: request 2 already gets full hits |
| Test B Reorder | Fact reorder kills cache | CONFIRMED: 256→0 hits |
| Test D Spaces | Whitespace shift kills cache | CONFIRMED: 2 bytes shift everything |
| Test E Partial | 1 changed fact kills all 19 identical | CONFIRMED: 256→0 hits |

## Key Findings

### 1. Token-value matching, not position
DeepSeek's prefix cache matches exact token values byte-by-byte from the start. Fixed-width formatting does NOT help — `"09"` ≠ `"10"` at the same byte position. 

### 2. Any divergence kills ALL subsequent cache
Changing ONE element anywhere in the prefix chain invalidates cache for EVERYTHING after it, regardless of whether subsequent content is byte-identical. This is strictly sequential — no content-addressed or key-value caching.

### 3. Multiple prefix units coexist
Old cache units survive new insertions. Sending variant A → variant B → variant A again = variant A still hits from its original cache unit.

### 4. Common prefix detection is fast
After just 1-2 requests with a shared prefix, DeepSeek detects and persists it. Subsequent requests with any suffix hit the cached prefix.

### 5. Dynamic date kills cache
`"Today's date: {date}"` anywhere in the prefix chain creates a daily cold start at midnight. The first request with a new date gets 0 cache hits. The fix: remove date from system prompt, inject at user message start where it doesn't affect the facts prefix.

### 6. Whitespace is not normalized
Two trailing spaces in an assistant message kills the entire cache chain. Every byte counts.

## Architecture Implications

### ✅ Viable: Immutable prefix strategy
- Place all stable/unchanged content at the front of the prefix
- This forms a cacheable knowledge region
- Changed/new content goes at the end

### ❌ Not viable: Facts-at-same-positions
- Expecting facts at the same positions to survive a mid-chain change
- DeepSeek's sequential cache does not support this

### ✅ Viable: MD5 pre-send audit
- Fingerprint messages before sending
- Compare with previous request's MD5
- Log `[cache:broken]` with exact divergence point before DeepSeek processes it

### ✅ In progress: Post-send verification
- Compare predicted cache behavior with actual `prompt_cache_hit_tokens`
- Log `[cache:miscalculation]` when prediction fails → fingerprint model refinement

## Files Affected

| File | Change |
|------|--------|
| `src/session/cache-control.ts` | NEW: MD5 fingerprinting, audit, per-session store |
| `src/session/prompt.ts` | Date→user msg, session banner, pre-send audit |
| `src/session/processor.ts` | Post-send cache verification |
| `src/session/message-v2.ts` | Per-message conversion cache (B2) |
| `src/session/compaction.ts` | Facts ordering rules in SUMMARY_TEMPLATE |
| `src/session/llm.ts` | System prompt assembly (no change needed) |
| `src/agent/agent.ts` | Removed PROMPT_COMPACTION |
| `test/experiments/20260610_cache_guardrail/` | Experiment suite (5 phases) |

## References

- [DeepSeek Context Caching Docs](https://api-docs.deepseek.com/guides/kv_cache)
- Plans: `plans/20260609_system_date_kills_cache.md`
- Plans: `plans/20260610_cache_guardrail_master.md`
- Plans: `plans/20260610_position_cache_experiments.md`
