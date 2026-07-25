# Phase 5: Compaction Guardrail Integration

Date: 2026-06-10  
Master Plan: `plans/20260610_cache_guardrail_master.md`  
Status: Plan

## Goal

Apply the cache guardrail specifically to the compaction pipeline. Measure cache continuity across compaction cycles and optimize the compaction output format for maximum cache stability.

## Why Compaction-Specific

Compaction is the most cache-sensitive operation because:

1. **It runs on the same model** as main chat (after today's system prompt fix)
2. **It reuses the same head messages** from previous compaction cycles
3. **It produces structured output** (SUMMARY_TEMPLATE) — format is cache-friendly
4. **It's automated** — runs without user intervention, so cache break has no human to notice
5. **Cache break in compaction = starting from scratch on the model's reasoning state** — worst case for output quality

## Measurement: Cache Continuity Across Compaction Cycles

### Setup

Build a session that goes through 3 compaction cycles:

```
Cycle 1: [msg1..msg100] → compaction → summary1 + synthetic tail
Cycle 2: [summary context + msg101..msg150] → compaction → summary2 + synthetic tail  
Cycle 3: [summary context × 2 + msg151..msg180] → compaction → summary3
```

### Metrics per cycle

| Metric | How to measure |
|--------|---------------|
| Cache hit tokens | `prompt_cache_hit_tokens` in API response |
| Cache miss tokens | `prompt_cache_miss_tokens` |
| Hit ratio | hit / (hit + miss) |
| Head message count | Number of WithParts in selected.head |
| Head token count | Estimated tokens in head |
| Summary length | Output tokens of summary assistant |
| Time to first token | Latency from request to first response byte |
| Total generation time | End-to-end compaction time |

### Expected pattern

| Cycle | Head size | Expected hit ratio | Why |
|-------|-----------|-------------------|-----|
| 1 | 100 messages | 0% | First request, no cache baseline |
| 2 | old_head + old_comp_pair + old_synth_tail | ~60-80% | Old head messages match Cycle 1 prefix |
| 3 | head2 + comp_pair2 + synth_tail2 | ~70-85% | Growing prefix = more cache hits |

## Guardrail Integration Points

### Point 1: Before compaction — check cache continuity

```ts
// compaction.ts:processCompaction — before processor.process()
const prevRequest = getPreviousCompactionRequest(sessionID) // from session history
const nextRequest = buildCompactionRequest(selected, prior, nextPrompt, model)
const report = guardrail.check(prevRequest, nextRequest)

if (report.recommendation.type === "restructure") {
  // Apply restructuring to nextRequest before sending
  log.info("compaction guardrail: restructuring", { 
    hitRatio: report.predictedHitRatio,
    changes: report.recommendation.changes 
  })
  nextRequest = report.restructuredRequest
}
```

### Point 2: After compaction — record cache metrics

```ts
// After processor.process() completes
const metrics = {
  hitTokens: result.usage?.prompt_cache_hit_tokens ?? 0,
  missTokens: result.usage?.prompt_cache_miss_tokens ?? 0,
  hitRatio: hit / (hit + miss),
  headTokens: selected.head.length,
  summaryTokens: processor.message.tokens.output,
}

// Store in session metadata for next cycle
yield* session.updateCompactionMetrics(sessionID, metrics)
```

### Point 3: Compaction summary format optimization

The SUMMARY_TEMPLATE is already cache-friendly (fixed headers, fixed section order). But we can further optimize:

**Current**: Bulleted lists within sections (bullets may appear/disappear)
```
## Progress
### Done
- fixed bug A
- added feature B
### In Progress  
- working on C
```

**Optimized**: Separate each fact into its own "unit" with stable identifiers:
```
## Progress
### Done
<fact id="done-1">fixed bug A</fact>
<fact id="done-2">added feature B</fact>
### In Progress
<fact id="in-progress-1">working on C</fact>
```

When `done-1` is removed (completed), only that fact unit diverges. All subsequent facts `done-2`, `in-progress-1` are at the same token position — they still cache hit.

**But**: This changes the summary format the user sees. This is a trade-off: cache stability vs human readability.

## Date Problem in Compaction

Recall: `processCompaction` passes `system: []` — NO date. So compaction doesn't have the date-in-system-prompt problem at all! The date only affects main chat.

But there IS a related issue: in `prompt.ts:1319`:
```ts
const system = [...rules, ...instructions, ...env, ...skills, ...envDate]
```

This `system` array is built once per chat loop iteration. If the date in `envDate` changes between iterations (rare: only at midnight), the NEXT compaction cycle's system prompt prefix diverges at the date token.

**Risk**: Low probability (only at midnight) but high impact (entire cache chain broken).

## Deliverable

**Script**: `phase5_integration.ts`

Functions:
```ts
// Before compaction
async function guardCompactionRequest(
  sessionID: string,
  request: CompactionRequest
): Promise<CompactionRequest>  // potentially restructured

// After compaction  
async function recordCompactionMetrics(
  sessionID: string,
  response: CompactionResponse
): Promise<void>

// Cache continuity analysis
async function analyzeCompactionCycles(
  sessionID: string,
  cycles: number
): Promise<CycleMetrics[]>
```

**Integration tests**: Run 3-cycle compaction simulation, verify:
1. Hit ratio increases with each cycle
2. Guardrail correctly predicts cache behavior
3. Restructured requests maintain output quality (measured via Phase 1 metrics)
4. No false positives (guardrail doesn't block valid compactions)

## Success Criteria

| Criterion | Target |
|-----------|--------|
| Cycle 2 hit ratio | > 60% of head tokens |
| Cycle 3 hit ratio | > 70% of head tokens |
| Guardrail precision | No false blocks |
| Guardrail recall | All actual cache breaks detected |
| Restructured quality | Semantic similarity > 0.90 vs non-restructured |
