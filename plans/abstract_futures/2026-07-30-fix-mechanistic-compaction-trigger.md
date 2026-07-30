# B6: Fix mechanistic compaction trigger — decouple from model context window

Framework: ADID 15.4.3. The in-band compaction/summary trigger in `prompt.ts`
uses `isOverflowFromContent()` which gates on `usable(model)` = 85% of model
context window. On 1M-context models this means summaries never fire until
~980K content tokens — far past the intended 65K interval.

## SVM: Vector summary

Semantic vector: `["content-based threshold", "decouple compaction from model window", "mechanistic summary trigger"]`
with weights `[0.50, 0.30, 0.20]`.

Information Mark: **Inferred** — derived from Exact source inspection of
`overflow.ts:103-115`, `prompt.ts:1345-1371`, `compaction.ts:203-216`.

## 1. Goal and scope

**Goal**: Make the in-band compaction/summary trigger fire at 65K content
tokens regardless of model context window size.

**Scope**: `packages/opencode/src/session/overflow.ts` (new function or modify
`isOverflowFromContent`), `packages/opencode/src/session/prompt.ts` (line 1350
— replace gate condition).

**Non-goals**: Do NOT change the emergency overflow path in `processor.ts:676-683`
(it correctly uses `usable()` to prevent actual model context errors). Do NOT
change `maybeCaptureSidecar` (it already uses `summaryWindowLimit` correctly).
Do NOT change `usable()` or `summaryWindowLimit()` themselves.

## 2. Current state assessment (Exact)

### P1: isOverflowFromContent gates on usable(model)

**File**: `packages/opencode/src/session/overflow.ts`, lines 103-115

```typescript
export function isOverflowFromContent(input) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  if (input.msgs.length === 0) return false
  const count = estimateContentTokens(input.msgs, input.model)
  const output = ProviderTransform.maxOutputTokens(input.model, undefined, count)
  return count >= usable(input) || count + output >= input.model.limit.context
}
```

`usable(input)` at `overflow.ts:20-29`:
```typescript
const limit = observedLimit ?? input.model.limit.input ?? context
const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, Math.floor(limit * 0.15))
return Math.max(0, limit - reserved)
```

For 1M context: `limit = 1_000_000`, `reserved = min(20000, 150000) = 20000`,
`usable = 980_000`.

`isOverflowFromContent` fires at `count >= 980_000` — way past 65K.

### P2: The in-band compaction block is gated by isOverflowFromContent

**File**: `packages/opencode/src/session/prompt.ts`, lines 1345-1371

```typescript
if (
  (lastFinished || lastAssistant) &&
  lastFinished?.summary !== true &&
  !pendingSummaryResponse &&
  !SessionCompaction.hasPendingSummaryRequest(msgs) &&
  isOverflowFromContent({ cfg: yield* config.get(), msgs, model })  // ← GATE
) {
  yield* compaction.compact({
    sessionID,
    model: lastUser.model,
    agent: lastUser.agent,
    threshold: summaryWindowLimit({  // ← correct (65K), but unreachable
      cfg: yield* config.get(),
      model,
      target: SessionCompaction.SUMMARY_INTERVAL_TOKENS,
    }),
  })
}
```

`summaryWindowLimit` correctly returns 65K, but it's inside a block gated by
`isOverflowFromContent` which returns false until 980K.

### P3: Emergency overflow path is correct and should NOT be changed

**File**: `packages/opencode/src/session/processor.ts`, lines 676-683

```typescript
if (
  !ctx.assistantMessage.summary &&
  (isOverflow({ cfg, tokens: usage.tokens, model }) ||
    (ctx.contentTokenEstimate !== undefined &&
      ctx.contentTokenEstimate >= usable({ cfg, model })))
)
```

This path prevents actual model context errors. `usable()` is the right
threshold here because it's a hard safety gate. **Do not touch.**

### P4: summaryWindowLimit already returns the correct value

**File**: `packages/opencode/src/session/overflow.ts`, lines 37-48

```typescript
return Math.max(1, Math.min(input.target, usable(input) - budget - headroom))
```

For 1M model: `min(65536, 980000 - budget - 2048)` = `65536`. Correct.

### P5: computeOpenWindowTokens counts from last summary/checkpoint

**File**: `packages/opencode/src/session/compaction.ts`, lines 203-216

Counts chars/4 from the last `summary: true` message or checkpoint boundary.
This is the right metric for "how much unsummarized content exists."

## 3. Root cause

Compaction is mechanistic — it reorganizes existing summaries + recent messages
into `message*`. It does NOT call the LLM and does NOT need output budget
reservation. The in-band path incorrectly uses `isOverflowFromContent` (which
reserves 15% for model output) instead of directly checking whether open-window
content tokens exceed the summary interval.

On models with small context (128K): `usable = 108K`, which is close to 65K
so summaries happen incidentally. On 1M models: `usable = 980K`, summaries
never happen.

## 4. Task definition

| # | Task | Weight | Dependencies | State |
|---|------|--------|--------------|-------|
| T1 | Add `needsCompactionFromContent()` to `overflow.ts` | 0.40 | — | pending |
| T2 | Replace gate in `prompt.ts:1350` | 0.35 | T1 | pending |
| T3 | Verify emergency path untouched | 0.10 | T1 | pending |
| T4 | Smoke tests + oracle verification | 0.15 | T1–T3 | pending |

## 5. Exact materialized transition

### T1: New function in overflow.ts

**File**: `packages/opencode/src/session/overflow.ts`, after line 115

```typescript
/**
 * Check whether the open content window exceeds the mechanistic summary
 * interval. Unlike {@link isOverflowFromContent}, this does NOT reserve
 * model output budget — compaction is a data reorganization, not an LLM
 * call. Use this for the in-band summary/compaction trigger.
 */
export function needsContentCompaction(input: {
  cfg: Config.Info
  msgs: MessageV2.WithParts[]
  model: Provider.Model
  target: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  if (input.msgs.length === 0) return false

  const threshold = summaryWindowLimit({
    cfg: input.cfg,
    model: input.model,
    target: input.target,
  })
  const openTokens = SessionCompaction.computeOpenWindowTokens(input.msgs)
  return openTokens >= threshold
}
```

### T2: Replace gate in prompt.ts

**File**: `packages/opencode/src/session/prompt.ts`, line 1350

```typescript
// Before:
isOverflowFromContent({ cfg: yield* config.get(), msgs, model })

// After:
needsContentCompaction({
  cfg: yield* config.get(),
  msgs,
  model,
  target: SessionCompaction.SUMMARY_INTERVAL_TOKENS,
})
```

Also update the import at top of prompt.ts to import `needsContentCompaction`
from overflow.ts (replace or augment the `isOverflowFromContent` import).

### T3: Verify emergency path untouched

```bash
grep -n "isOverflow\|usable(" packages/opencode/src/session/processor.ts
```

Must show only lines 676-683 using `isOverflow` (token-based) and `usable()`
for the emergency gate. No changes needed.

## 6. Verification criteria (oracles)

| # | Oracle | Pass criteria |
|---|--------|---------------|
| O1 | `bun run typecheck` from `packages/opencode` | pass |
| O2 | `bun test test/session/overflow.test.ts` (if exists) or compaction tests | pass |
| O3 | Code review: emergency path untouched | `processor.ts:676-683` unchanged |
| O4 | Logic: on 128K model, `needsContentCompaction` fires at ~65K | `summaryWindowLimit(128K) ≈ 65K` |
| O5 | Logic: on 1M model, `needsContentCompaction` fires at ~65K | `summaryWindowLimit(1M) ≈ 65K` |
| O6 | Logic: `isOverflowFromContent` still works for its callers (if any remain) | unchanged behavior |

## 7. Smoke Tests (PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun run typecheck` from `packages/opencode` | pass | (record) |
| 2 | `bun test test/session/compaction.test.ts --timeout 30000` from `packages/opencode` | 78 pass | (record) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun run typecheck` from `packages/opencode` | pass |
| 2 | `bun test test/session/compaction.test.ts --timeout 30000` from `packages/opencode` | 78 pass |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## 8. Information Mark ledger

| Claim | Status | Premises | Evidence |
|-------|--------|----------|----------|
| isOverflowFromContent gates on usable(model) | Exact | P1 | Source: overflow.ts:103-115 |
| In-band compaction unreachable on 1M models | Exact | P2 | Source: prompt.ts:1345-1371, overflow.ts:20-29 |
| summaryWindowLimit returns 65K correctly | Exact | P4 | Source: overflow.ts:37-48 |
| Compaction is mechanistic (no LLM call) | Exact | P5 | compaction.ts uses existing summaries + contentChars |
| Emergency overflow path is correct | Exact | P3 | processor.ts:676-683 uses usable() for hard safety |
| Fix will make summaries fire at 65K on any model | Inferred | P4, T1, T2 | Derived: needsContentCompaction uses summaryWindowLimit directly |

## 9. Non-destructive boundary

- Do NOT change `usable()` or `summaryWindowLimit()` — they are correct
- Do NOT change `isOverflowFromContent()` — it may have other callers
- Do NOT change `processor.ts:676-683` — emergency overflow is correct
- Do NOT change `maybeCaptureSidecar` — it already works correctly
- Do NOT change `computeOpenWindowTokens` — it is correct
- Do NOT change the compaction algorithm itself
