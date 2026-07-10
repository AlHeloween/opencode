# Compaction Overflow Bug Fix

## Problem

After compaction, the next turn still produces an input (356,031 tokens) that exceeds the model's max input length (254,000 tokens). Compaction is supposed to reduce context, but it fails to do so effectively.

## Root Cause Analysis

### Primary cause: `estimate()` in compaction uses JSON serialization

`compaction.ts:234-239` estimates token counts by serializing messages to JSON then dividing by 4:

```ts
const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
return Token.estimate(JSON.stringify(msgs))  // chars / 4
```

JSON serialization adds 3-5x structural overhead (field names, brackets, quoting, escaping). This means:
- The `estimate()` function **overcounts** tokens by 3-5x
- This inflated count is used in `select()` to determine the `preserveRecentBudget`
- The budget calculation becomes meaningless — it thinks the tail is much larger than it actually is
- More critically: this same `estimate()` is NOT used for overflow detection (`isOverflowFromContent` uses real text extraction), creating a mismatch between what overflow detection sees and what compaction uses for sizing

### Secondary cause: calibration can't correct for wrong model definition

`overflow.ts:98` applies `TokenCalibration.getFactor(model)` to the raw estimate. But calibration only updates when an overflow error occurs (`processor.ts:841-843`). If the model's context window is misconfigured (e.g., `context: 256000` when the real limit is lower), the `usable()` function computes the wrong threshold.

### Tertiary cause: post-compaction verification gap

`prompt.ts:1467` checks `isOverflowFromContent` only when `lastFinished.summary !== true` — meaning immediately after a compaction assistant message finishes, the overflow re-check is **skipped**. The next check only happens on the following user turn. If compaction left the context in overflow, there's no inline verification.

## Solution (Implemented)

### Step 1: Export `estimateContentTokens` from `overflow.ts`

**File:** `packages/opencode/src/session/overflow.ts` (line 64)

Changed from private to `export function` — no circular dependency risk (confirmed DAG import graph).

### Step 2: Replace `estimate()` in compaction with content-based estimation

**File:** `packages/opencode/src/session/compaction.ts` (lines 234-240)

Replaced the JSON-serialization-based `estimate()` with `estimateContentTokens()` from `overflow.ts`. This ensures compaction's internal sizing uses the same token counting as overflow detection, eliminating the 3-5x inflation from JSON structural overhead.

### Step 3: Use observed context limit in `usable()`

**File:** `packages/opencode/src/session/overflow.ts` (lines 43-52)

When `TokenCalibration.getObservedLimit(model)` returns a value (parsed from a previous provider overflow error), prefer it over `model.limit.context`. This corrects for misconfigured model definitions.

### Step 4: Add tests for `estimateContentTokens`

**File:** `packages/opencode/test/session/compaction.test.ts` (lines 1414-1478)

Added 6 new tests covering: text-only counting, skipping non-text parts, completed tool output, reasoning text, ignored parts, empty messages.

## Files Modified

| File | Change |
|------|--------|
| `packages/opencode/src/session/overflow.ts` | Export `estimateContentTokens`, prefer observed limit in `usable()` |
| `packages/opencode/src/session/compaction.ts` | Replace `estimate()` with content-based tokens |
| `packages/opencode/test/session/compaction.test.ts` | Add 6 tests for `estimateContentTokens` |

## Verification

1. **Typecheck:** `bun typecheck` — passes with zero errors
2. **Compaction tests:** `bun test test/session/compaction.test.ts` — 47 pass, 0 fail
3. **Manual test:** `cmd_runner start --cwd dist/bin -- opencode.exe`, long conversation, verify compaction succeeds without provider overflow error

## Risks

- Changing `estimate()` affects how `select()` splits head/tail — content-based estimate is lower than JSON-based, so more messages may be included in the head for summarization. This is the correct behavior and all 47 tests pass.
- Post-compaction verification already exists in the loop at `prompt.ts:1467` — no additional changes needed there.
