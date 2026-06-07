# Kat-Coder Cache Regression Investigation

**Status:** draft
**Created:** 2026-06-04
**Goal:** Identify why kat-coder (streamlake-openai-3 / `@ai-sdk/openai-compatible`) always shows cold cache starts in the new build (v10.0.89) when it worked in the old build (v10.0.88). DeepSeek caching works in both builds.

## Context

10 files were changed between v10.0.88 and v10.0.89. None touch the LLM request path (`transform.ts`, `provider.ts`, gateway layer). The cache markers (`cache_control`) and `promptCacheKey` logic are unchanged. Yet kat-coder never gets a cache hit.

The only schema-level change that could cascade into the request path is: `Session.Info` now requires `cost: Schema.Number` and `tokens: Schema.Struct<...>` fields. If session creation or read fails Zod validation, it could affect session ID resolution or cache key computation downstream.

## Investigation Tasks

### Task 1: Rule out Session.Info schema as root cause

**File:** `packages/opencode/src/session/session.ts` lines 155-180

- [ ] Temporarily make `cost` and `tokens` fields `Schema.optional` with defaults
- [ ] Rebuild
- [ ] Test kat-coder caching in tst2
- [ ] If cache returns → schema validation IS the root cause; fix the schema to be backward-compatible
- [ ] If cache still cold → schema is NOT the cause; proceed to Task 2

### Task 2: Add diagnostics logging to verify cache markers are sent

**File:** `packages/opencode/src/provider/transform.ts`

- [ ] In `message()` at line 366-368, log: `{providerID, apiNpm, cachingApplied: true/false}` when deciding whether to call `applyCaching()`
- [ ] In `options()` at line 928-935, log: `{providerID, promptCacheKey, setCacheKey}` when `promptCacheKey` is set on the result
- [ ] Rebuild and test — verify `cachingApplied=true` and `promptCacheKey` is set for kat-coder requests

### Task 3: Log actual HTTP request body for cache markers

**File:** `packages/opencode/src/session/llm.ts` or gateway layer

- [ ] At the point where the AI SDK request is about to be sent, log the presence of `cache_control` in the first system message
- [ ] Confirm the marker actually reaches the wire
- [ ] Compare against OLD build behavior

### Task 4: Compare request bodies between OLD and NEW

**If Tasks 1-3 don't identify the issue:**

- [ ] Add request-body logging in both builds
- [ ] Send identical prompts to kat-coder
- [ ] Diff the HTTP request bodies to find what changed

## Test Cases

1. **Schema rollback test:** Make `cost`/`tokens` optional → kat-coder cache works → confirmed schema issue
2. **Diagnostic log test:** Request with kat-coder → `cachingApplied=true`, `promptCacheKey=ses_xxx:agent:model` in logs
3. **Cache marker wire test:** Request body contains `"cache_control":{"type":"ephemeral"}` on system messages
4. **OLD vs NEW diff:** Identical prompt → request bodies match except for timestamps/session IDs

## Verification

- [ ] `bun typecheck` passes after each task
- [ ] Log output confirms cache markers are sent for kat-coder
- [ ] kat-coder shows `cacheReadTokens > 0` on 2nd+ request in same session

## Non-Goals

- Do not modify behavior outside diagnostic logging until root cause is confirmed
- Do not change the production cache key logic until schema issue is ruled out
- Do not rebuild the Aurora_Python project — test only in bin_tst/tst2
