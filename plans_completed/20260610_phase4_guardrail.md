# Phase 4: Guardrail Prototype

Date: 2026-06-10  
Master Plan: `plans/20260610_cache_guardrail_master.md`  
Status: Plan

## Goal

Build the predictive guardrail as a TypeScript module that integrates Phase 2 (divergence detection) and Phase 3 (semantic equivalence) to predict cache behavior BEFORE sending a request to DeepSeek.

## Architecture

```
                 ┌──────────────────────────┐
                 │     llm.ts:streamText()   │
                 │                          │
  Request ──────►│  Guardrail.check()       │
                 │    ├─ Phase 2: LCP       │
                 │    ├─ Phase 3: semantic   │
                 │    └─ Decision matrix     │
                 │                          │
                 │  if PASS: streamText()   │
                 │  if WARN: log + stream   │
                 │  if BLOCK: restructure   │
                 └──────────────────────────┘
```

## API

```ts
export interface GuardrailConfig {
  minHitRatio: number         // minimum acceptable cache hit ratio (default: 0.5)
  mode: "warn" | "block"     // warn only, or block and restructure
  dateStrategy: "remove" | "move_to_user" | "warn"
  semanticThreshold: number   // from Phase 3 calibration
  maxRestructureAttempts: number
}

export interface GuardrailReport {
  passed: boolean
  predictedHitRatio: number
  divergence: DivergenceReport    // from Phase 2
  semanticMatches: FactChangeReport | null  // from Phase 3 (when relevant)
  recommendation: GuardrailAction
  restructuredRequest?: Request   // if restructured
}

export type GuardrailAction =
  | { type: "pass"; reason: string }
  | { type: "warn"; cause: DivergenceCause; detail: string }
  | { type: "block"; cause: DivergenceCause; fix: string }
  | { type: "restructure"; changes: RestructureChange[]; newRequest: Request }
```

## Decision Matrix

| Condition | Action | Reason |
|-----------|--------|--------|
| predictedHitRatio >= minHitRatio | `pass` | Cache will be fine |
| predictedHitRatio < minHitRatio AND cause = "date_changed" | `warn` or restructure | Date divergence is fixable |
| predictedHitRatio < minHitRatio AND cause = "system_prompt_changed" | `block` | Major change, needs human review |
| predictedHitRatio < minHitRatio AND cause = "new_message_appended" | `pass` (adjust minHitRatio) | Expected — messages grow |
| predictedHitRatio < minHitRatio AND cause = "message_modified" AND semantic match > 0.85 | `warn` | Same meaning, different wording |
| predictedHitRatio < minHitRatio AND cause = "message_modified" AND semantic match < 0.85 | `block` | Content genuinely changed |
| predictedHitRatio < minHitRatio AND cause = "section_reordered" | `warn` or restructure | Fixable by reordering |

## Restructuring Strategies

### Strategy 1: Move date out of system prompt

If `divergenceCause === "date_changed"`:
1. Remove `"Today's date: {date}"` from `system[2]`
2. Inject date as first token of first `user` message
3. Recompute divergence → cache hit for system[0..2] restored

### Strategy 2: Reorder sections to move stable content first

If facts are semantically stable but reordered:
1. Identify facts present in both old and new (from Phase 3)
2. Reorder new facts to match old order for cache-stable facts
3. Append new/changed facts at the end

### Strategy 3: Keep original wording for cache-stable content

If a fact is semantically equivalent but reworded:
1. Detect via Phase 3 semantic match
2. Replace new wording with original wording
3. Recompute → cache hit restored

## Integration Point in `llm.ts`

```ts
// llm.ts — before streamText()
const guardrail = getGuardrail(config)

if (previousRequest) {
  const report = guardrail.check(previousRequest, currentRequest)
  
  if (report.passed) {
    log.info("guardrail: pass", { hitRatio: report.predictedHitRatio })
  } else if (report.recommendation.type === "warn") {
    log.warn("guardrail: cache break predicted", {
      hitRatio: report.predictedHitRatio,
      cause: report.recommendation.cause,
    })
  } else if (report.recommendation.type === "restructure") {
    log.info("guardrail: restructuring request", {
      changes: report.recommendation.changes,
    })
    currentRequest = report.restructuredRequest
  }
}

// Proceed with streamText() using (potentially restructured) request
```

## Test Cases

| Test | Scenario | Expected Guardrail Action |
|------|----------|--------------------------|
| G01 | Two identical requests | pass, hitRatio=1.0 |
| G02 | Date changed (June9→June10), everything else same | warn (date_changed) |
| G03 | New user message appended | pass (new_message_appended) |
| G04 | System prompt changed completely | block |
| G05 | Tool output text changed (different error message) | block or warn |
| G06 | Compaction summary reworded, 80% facts semantically same | warn (high semantic match) |
| G07 | Compaction sections reordered A,C,B vs A,B,C | restructure |
| G08 | Date changed, restructure enabled | restructure (move date to user) |
| G09 | First request (no previous) | pass (no baseline) |
| G10 | Identical after restructuring applied | pass |

## Deliverable

**Script**: `phase4_guardrail.ts`

Exports:
```ts
export class CacheGuardrail {
  constructor(config: GuardrailConfig)
  check(prevRequest: Request | null, nextRequest: Request): GuardrailReport
  restructure(report: GuardrailReport): Request | null
}

export function createGuardrail(config?: Partial<GuardrailConfig>): CacheGuardrail
```

**Test file**: `phase4_guardrail.test.ts` — 10 test cases (G01-G10)
