# Plan: Fix Stale OpenRouter Reasoning Test

**Date:** 2026-06-21
**Status:** Complete
**Scope:** `packages/opencode/test/session/message-v2.test.ts`

## Goal

Fix the pre-existing `preserves OpenRouter reasoning details through provider transform` test failure (line 925-927) caused by a stale expectation after the `applyCaching` function was expanded to cover `deepseek` models.

## Problem Summary

The test at line 925 expected the text part of the assistant message to have **no** `providerOptions`:

```ts
{ type: "text", text: "answer" }
```

But the implementation now returns the text part **with** `providerOptions` containing cache-control hints for all providers:

```ts
{
  type: "text", text: "answer",
  providerOptions: {
    alibaba: { cacheControl: { type: "ephemeral" } },
    anthropic: { cacheControl: { type: "ephemeral" } },
    bedrock: { cachePoint: { type: "default" } },
    copilot: { copilot_cache_control: { type: "ephemeral" } },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
    openrouter: { cacheControl: { type: "ephemeral" } },
  }
}
```

### Root cause

1. Test was written (commit `e7053c41f`, Apr 2026) when `applyCaching` only triggered for Anthropic/Alibaba providers
2. Later commits expanded the trigger condition to include `deepseek`, `openai`, `openai-compatible`, `azure`, `github-copilot`
3. The test model has `id: "deepseek/deepseek-v4-pro"` which now **matches** `model.api.id.includes("deepseek")`
4. `applyCaching` fires → injects `providerOptions` on the text part
5. Test expectation was never updated

### Verdict

**Implementation is correct, test expectation is stale.** The multi-provider `providerOptions` injection is by design — each provider's SDK only reads its own namespace key. The test just needs its expected value synced with reality.

## Implementation

### Single-file change: `test/session/message-v2.test.ts`

**Lines 927-943** — add `providerOptions` to the text part expectation:

```ts
{
  type: "text",
  text: "answer",
  providerOptions: {
    openrouter: {
      reasoning_details: reasoningDetails,
    },
    alibaba: {
      cacheControl: { type: "ephemeral" },
    },
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
    bedrock: {
      cachePoint: { type: "default" },
    },
    copilot: {
      copilot_cache_control: { type: "ephemeral" },
    },
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
  }
}
```

Note: `openrouter` key now carries TWO things — the `reasoning_details` from the existing test AND the `cacheControl` from `applyCaching`. The merge is performed by `Object.assign` in the implementation, so both properties coexist.

Wait — actually let me check. The test currently has the reasoning_details as a SEPARATE `providerOptions.openrouter` on the reasoning part (line 934-938). The `applyCaching` function adds `providerOptions.openrouter.cacheControl` to the LAST content part (which is the text part). These are two separate parts — the reasoning part keeps `reasoning_details`, the text part gets `cacheControl`. They don't collide.

Correct final expectation:
```ts
// Reasoning part (existing, unchanged):
{
  type: "reasoning",
  text: "thinking",
  providerOptions: {
    openrouter: {
      reasoning_details: reasoningDetails,
    },
  },
}
// Text part (stale, needs update):
{
  type: "text",
  text: "answer",
  providerOptions: {
    alibaba: { cacheControl: { type: "ephemeral" } },
    anthropic: { cacheControl: { type: "ephemeral" } },
    bedrock: { cachePoint: { type: "default" } },
    copilot: { copilot_cache_control: { type: "ephemeral" } },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
    openrouter: { cacheControl: { type: "ephemeral" } },
  },
}
```

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| None — pure test fix | None | This is updating test expectations to match real behavior. No production code changes. |

## Files Modified

| File | Action | Lines |
|------|--------|-------|
| `test/session/message-v2.test.ts` | MODIFY | ~15 lines added to expectation at ~940 |

## Verification

1. `bun test test/session/message-v2.test.ts` — all 31 tests pass, 0 failures
2. `bun typecheck` — clean

## Completion Checklist

- [x] Update text part expectation at lines 940-943 to include `providerOptions`
- [x] All 31 tests pass
- [x] TypeScript compilation clean

## Oracle Results
```
bun test test/session/message-v2.test.ts: 31 pass, 0 fail
```