# Plan: Full AI SDK v7 Compatibility

**Created:** 2026-07-03T05:15
**Status:** active
**Goal:** Remove all deprecated aliases and `as any` casts for complete v7 compliance

## Current State

AI SDK v7.0.14 installed. Typecheck passes. Deprecated aliases still work but should be migrated.

---

## Task 1: `fullStream` → `stream` [ ]

**Files:**
- `src/session/llm.ts` line 130: type derivation `Result["fullStream"]` → `Result["stream"]`
- `src/session/llm.ts` line 570: `result.fullStream` → `result.stream`
- `src/agent/agent.ts` line 479: `result.fullStream` → `result.stream`

**Risk:** Low — `stream` is the primary property in v7, `fullStream` is deprecated alias.

---

## Task 2: `system` → `instructions` in streamText [ ]

**File:** `src/session/llm.ts` lines 506-508

Current:
```ts
...(isOpenaiOauth || isWorkflow
  ? {}
  : { system: system.map((content) => ({ role: "system" as const, content })) })
```

v7:
```ts
...(isOpenaiOauth || isWorkflow
  ? {}
  : { instructions: system })
```

Note: v7 `instructions` accepts `string | string[]` directly — no need to wrap as system-role messages.

**Risk:** Medium — need to verify all providers handle `instructions` correctly. Some providers may still expect `system`.

---

## Task 3: `experimental_repairToolCall` [ ]

**Status:** No change needed. In v7, the property name IS still `experimental_repairToolCall` — there's no non-experimental alias. The migration guide is misleading; only lifecycle callbacks got renamed.

---

## Task 4: `ai-gateway-provider` — Cloudflare Gateway [ ]

**File:** `src/provider/provider.ts` lines 759-793

**Problem:** `ai-gateway-provider@3.2.0` uses `LanguageModelV3`. We use `as any` cast.

**Options:**
- **A)** Wait for `ai-gateway-provider` to release v4 (upstream issue)
- **B)** Fork and patch `ai-gateway-provider` to use `LanguageModelV4`
- **C)** Replace with direct Cloudflare AI Gateway HTTP calls (our `src/provider/gateway/` already has H2 transport)
- **D)** Keep `as any` — runtime works, only types are unsafe

**Recommendation:** Option D for now. Cloudflare AI Gateway is an optional feature. The `as any` cast is safe at runtime because the gateway just proxies doStream/doGenerate calls.

**Risk:** Low — only affects Cloudflare AI Gateway users.

---

## Task 5: Copilot provider internal types [ ]

**Files:**
- `src/provider/sdk/copilot/responses/openai-responses-language-model.ts` lines 810-817
- `src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` line 357

**Status:** These `reasoningTokens`/`cachedInputTokens` fields are INTERNAL to our custom Copilot provider — they're part of our own usage tracking object, not AI SDK's `LanguageModelUsage`. They map FROM the provider's raw response TO our internal format, then get converted to `inputTokenDetails.cacheReadTokens` / `outputTokenDetails.reasoningTokens` in the output.

**No change needed** — these are internal types, not AI SDK deprecated fields.

---

## Task 6: Remove `as any` in BundledSDK [ ]

**File:** `src/provider/provider.ts` line 89

Current: `languageModel(modelId: string): any`

**Problem:** Third-party providers (`@openrouter/ai-sdk-provider`, `gitlab-ai-provider`, `venice-ai-sdk-provider`) still return `LanguageModelV3`. Once they update to v4, we can restore the typed return.

**Options:**
- **A)** Wait for third-party providers to update
- **B)** Use conditional types: `LanguageModelV3 | LanguageModelV4`
- **C)** Keep `any` — the BUNDLED_PROVIDERS map is only used for dynamic loading, types don't affect runtime

**Recommendation:** Option B — use union type for better safety:
```ts
type BundledSDK = {
  languageModel(modelId: string): LanguageModelV3 | LanguageModelV4
}
```

---

## Task 7: Typecheck + test [ ]

```bash
cd packages/opencode && bun typecheck
```

---

## Priority Order

1. Task 1 (fullStream → stream) — trivial, zero risk
2. Task 6 (BundledSDK union type) — trivial, improves safety
3. Task 2 (system → instructions) — medium risk, needs testing
4. Task 4 (ai-gateway-provider) — blocked on upstream
5. Tasks 3, 5 — no change needed

## Files Modified (expected)

- `src/session/llm.ts`
- `src/agent/agent.ts`
- `src/provider/provider.ts`
