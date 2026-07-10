# Fix: OpenAI GPT-5.x `max_tokens` → `max_completion_tokens` Parameter

**Date**: 2026-07-10
**Status**: Done
**Upstream**: [anomalyco/opencode#5421](https://github.com/anomalyco/opencode/issues/5421)

## Root Cause

OpenAI GPT-5.x and o-series reasoning models reject `max_tokens` in Chat Completions API. They require `max_completion_tokens` instead.

```
400 Bad Request
Unsupported parameter: 'max_tokens' is not supported with this model.
Use 'max_completion_tokens' instead.
```

### Architecture — Two Code Paths

| Path | Package | Status | File |
|------|---------|--------|------|
| Standard OpenAI | `@ai-sdk/openai` (v3.0.80/4.0.7) | ✅ Already converts `max_tokens`→`max_completion_tokens` for reasoning models | `node_modules/@ai-sdk/openai/src/chat/openai-chat-language-model.ts:272-278` |
| Custom compatible | `@ai-sdk/openai-compatible` (built-in) | ❌ Always sends `max_tokens`, no reasoning conversion | `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts:148` |

### Reasoning Model Detection (`@ai-sdk/openai`)

```typescript
// openai-language-model-capabilities.ts:32-36
const isReasoningModel =
  modelId.startsWith('o1') ||
  modelId.startsWith('o3') ||
  modelId.startsWith('o4-mini') ||
  (modelId.startsWith('gpt-5') && !modelId.startsWith('gpt-5-chat'));
```

`gpt-5.6-luna-pro` matches — detected as reasoning model ✅

## Plan

### Phase 1: Test Current State [done]

1. [x] Check logs for previous error — Found: `"Unsupported parameter: max_output_tokens"` on Responses API for `gpt-5.6-luna`
2. [x] Identify API path — Error is on Responses API (`/v1/responses`), NOT Chat Completions
3. [x] Determine root cause — `@ai-sdk/openai` Responses model sends `max_output_tokens` for all models, but GPT-5.6-luna rejects it for reasoning models

### Phase 2: Fix [done]

**File**: `packages/opencode/src/session/llm.ts:306-314`

**Approach**: Drop `maxOutputTokens` for OpenAI reasoning models using Responses API (same pattern as Cloudflare plugin for Chat API):

```typescript
// OpenAI Responses API reasoning models (gpt-5.x, o-series) reject
// max_output_tokens with "Unsupported parameter: max_output_tokens".
if (input.model.providerID === "openai" && input.model.capabilities.reasoning) {
  maxOut = undefined
}
```

**Why**: 
- `@ai-sdk/openai` already handles `max_tokens→max_completion_tokens` conversion for Chat API Chat models
- But the Responses model (`openai-responses-language-model.ts:336`) always sends `max_output_tokens`
- OpenAI's own docs say to omit `max_output_tokens` or set to >=20000 for certain requests
- Dropping the cap lets the model use its default output budget

### Phase 3: Verify [done]

1. [x] `bun typecheck` in `packages/opencode/` — passes
2. [x] `bun test` — 53 pass, 12 fail (all pre-existing Effect context issues, unrelated)
3. [x] Build — `_build.ps1` succeeds (binary at `dist/bin/opencode.exe`)

## Files Modified

| File | Change |
|------|--------|
| `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` | Add `max_completion_tokens` for reasoning models |

## References

- OpenAI docs: [Controlling response length](https://help.openai.com/en/articles/5072518) — `max_completion_tokens` is the current parameter for Chat Completions
- `@ai-sdk/openai` already handles this: `openai-chat-language-model.ts:272-278`
- Upstream issue: [anomalyco/opencode#5421](https://github.com/anomalyco/opencode/issues/5421)
- litellm fix: [BerriAI/litellm#13381](https://github.com/BerriAI/litellm/issues/13381)
- Cloudflare plugin workaround: `cloudflare.ts:64-74` (drops token limit for reasoning models)
