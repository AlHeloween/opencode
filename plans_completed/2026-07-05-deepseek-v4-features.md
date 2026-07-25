# DeepSeek V4 Pro Feature Completion

## Goal
Complete deepseek-v4-pro API feature support by adding missing request parameters,
finish reason handling, context cache usage metrics, and cleaning variant effort levels.

## Current State

| What we do | How | Status |
|---|---|---|
| Reasoning content extraction | `reasoning_content` stream parsing plus `providerOptions.openaiCompatible.reasoning_content` passback | OK |
| Multi-turn reasoning preservation | Empty `reasoning` part on all assistant msgs for deepseek models | OK |
| Reasoning effort variants | `low`, `medium`, `high`, `max` all return `{ reasoningEffort: effort }` | Misleading |
| V4 "max" effort | Appended to `WIDELY_SUPPORTED_EFFORTS` in `@ai-sdk/openai-compatible` case | OK |
| `thinking` parameter | Not sent — relies on API default (`enabled`) | Missing |
| `insufficient_system_resource` finish reason | Not handled | Missing |
| Context cache metrics | `prompt_cache_hit/miss_tokens` normalized into `inputTokens.cacheRead/noCache` | OK |
| V4 context window | May be incorrect (128K legacy) | Verify |

## Reference Sources

- **DeepSeek API Docs**: `https://api-docs.deepseek.com/guides/thinking_mode`, `/api/create-chat-completion`, `/api/create-completion`
- **DeepSeek-TUI** (Rust reference implementation): Sets `thinking: { type: "enabled" }` for all non-off efforts,
  uses `https://api.deepseek.com/beta` as default base_url, dual-format usage parsing
  (`prompt_cache_hit_tokens` → `prompt_tokens_details.cached_tokens` fallback)

## Implementation

### 1. `options()` — Send `thinking` explicitly

**File**: `packages/opencode/src/provider/transform.ts`

Add V4 case in `options()` (after existing openai-compatible blocks, before gpt-5):

```ts
if (input.model.api.id.includes("deepseek-v4") && input.model.api.npm === "@ai-sdk/openai-compatible") {
  result["thinking"] = { type: "enabled" }
}
```

Matches the first-call API example and DeepSeek-TUI pattern. Puts
`"thinking": {"type": "enabled"}` in the request body alongside `reasoning_effort`.
Does not change any existing behavior for non-V4 models.

**Location**: After the zai/zhipuai block (~line 895).

### 2. `variants()` — Clean effort levels

**File**: `packages/opencode/src/provider/transform.ts` lines 574-579

Replace:
```ts
case "@ai-sdk/openai-compatible":
  const efforts = [...WIDELY_SUPPORTED_EFFORTS]
  if (model.api.id.includes("deepseek-v4")) {
    efforts.push("max")
  }
  return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
```

With:
```ts
case "@ai-sdk/openai-compatible":
  const efforts = [...WIDELY_SUPPORTED_EFFORTS]
  if (model.api.id.includes("deepseek-v4")) {
    return {
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    }
  }
  return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
```

Remove `low`/`medium` which silently map to `high` per DeepSeek API docs.
V4 users see only functional effort levels. Non-V4 openai-compatible models
unchanged.

### 3. `insufficient_system_resource` finish reason

**File**: `packages/opencode/src/provider/sdk/copilot/chat/map-openai-compatible-finish-reason.ts`

Add before `default: return "other"`:
```ts
case "insufficient_system_resource":
  return "error"
```

Confirmed in both `/chat/completions` and `/completions` API references.

### 4. Context cache usage metrics

**File**: `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts`

#### 4a. Schema (line 726-743)

Add to `openaiCompatibleTokenUsageSchema`:
```ts
prompt_cache_hit_tokens: z.number().nullish(),
prompt_cache_miss_tokens: z.number().nullish(),
```

#### 4b. Non-streaming extraction (line 280-293)

Add alongside existing capture and normalize into `inputTokens`:
```ts
inputTokens: {
  total: responseBody.usage?.prompt_tokens ?? undefined,
  noCache: responseBody.usage?.prompt_cache_miss_tokens ?? undefined,
  cacheRead:
    responseBody.usage?.prompt_cache_hit_tokens
    ?? responseBody.usage?.prompt_tokens_details?.cached_tokens
    ?? undefined,
  cacheWrite: undefined,
}
```

Use dual-format pattern from DeepSeek-TUI: try `prompt_cache_hit_tokens` first
(API spec says required), fallback to `prompt_tokens_details.cached_tokens`
(V4 alternate format).

#### 4c. Streaming accumulation (lines 431-450)

Add alongside existing `usage.completionTokensDetails` capture:
```ts
if (value.usage?.prompt_cache_hit_tokens != null) {
  usage.promptCacheHitTokens = value.usage.prompt_cache_hit_tokens
}
if (value.usage?.prompt_cache_miss_tokens != null) {
  usage.promptCacheMissTokens = value.usage.prompt_cache_miss_tokens
}
```

Finish events normalize those fields into `inputTokens.cacheRead` and
`inputTokens.noCache`; raw usage still carries the DeepSeek field names.

#### 4d. Native reasoning content

OpenAI-compatible streaming now accepts DeepSeek's `delta.reasoning_content`
as a reasoning part, and assistant messages can pass
`providerOptions.openaiCompatible.reasoning_content` back to the native API.

### 5. V4 context window (verified — no changes)

`models-snapshot.js` already has correct 1,000,000 token context for V4 models
across all providers. Legacy models (deepseek-chat, deepseek-r1, deepseek-v3)
have 128K. No update needed.

### 6. Tests

**File**: `packages/opencode/test/provider/transform.test.ts`

#### Test: `options()` returns `thinking` for V4
```ts
test("deepseek-v4 options include thinking: { type: enabled }", () => {
  const model = createMockModel({
    id: "deepseek/deepseek-v4-pro",
    providerID: "deepseek",
    api: { id: "deepseek-v4-pro", url: "https://api.deepseek.com", npm: "@ai-sdk/openai-compatible" },
    capabilities: { reasoning: true, interleaved: { field: "reasoning_content" } },
  })
  const result = ProviderTransform.options({ model, sessionID: "test" })
  expect(result.thinking).toEqual({ type: "enabled" })
})

test("deepseek-v4-flash options include thinking: { type: enabled }", () => {
  // Same structure, different model ID
})

test("non-deepseek openai-compatible does NOT include thinking", () => {
  // Verify kimi/qwen etc. don't get thinking field
})
```

#### Test: `variants()` returns only `high`/`max` for V4
Existing test at line 2218 covers `deepseek-chat` returning `{}`.
Add test for V4:
```ts
test("deepseek-v4 returns high and max efforts only", () => {
  const model = createMockModel({
    id: "deepseek/deepseek-v4-pro",
    providerID: "deepseek",
    api: { id: "deepseek-v4-pro", url: "https://api.deepseek.com", npm: "@ai-sdk/openai-compatible" },
    capabilities: { reasoning: true },
  })
  const result = ProviderTransform.variants(model)
  expect(result).toEqual({
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "max" },
  })
  expect(result.low).toBeUndefined()
  expect(result.medium).toBeUndefined()
})
```

#### Test: `insufficient_system_resource` finish reason

**File**: `packages/opencode/test/provider/sdk/copilot/chat/map-openai-compatible-finish-reason.test.ts`
```ts
import { mapOpenAICompatibleFinishReason } from "@/provider/sdk/copilot/chat/map-openai-compatible-finish-reason"

test("maps insufficient_system_resource to error", () => {
  expect(mapOpenAICompatibleFinishReason("insufficient_system_resource")).toBe("error")
})
```

## Files Changed

| File | Phase | Change |
|---|---|---|
| `packages/opencode/src/provider/transform.ts` | 1, 2 | `options()` adds `thinking`, `variants()` cleans V4 efforts |
| `packages/opencode/src/provider/sdk/copilot/chat/map-openai-compatible-finish-reason.ts` | 3 | Add finish reason case |
| `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` | 4 | Schema + usage extraction (dual format) |
| `packages/opencode/test/provider/transform.test.ts` | 6 | New test cases |

## Verification

1. `bun typecheck` in `packages/opencode`
2. `bun test` in `packages/opencode`
3. Build smoke test: `pwsh _build.ps1`

## Out of Scope

- `reasoning_effort: "off"` / thinking toggle — user has separate general/explorer model
- Chat Prefix Completion (beta) — requires `base_url="https://api.deepseek.com/beta"`
- `strict` function calling (beta) — requires beta endpoint + schema nesting under `function`
- FIM completion — separate `/completions` endpoint, not chat-based
- Prefix cache warmup — optimization technique, not a feature gap
- `reasoning_replay_tokens` — approximate cost metric, no API field for it
- deepseek-v4-flash — focused on v4-pro only
