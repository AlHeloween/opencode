# Cache Collapse Recovery Plan

**Status:** complete for cache-collapse recovery; conservative stream timeout implemented separately with runtime tests pending
**Created:** 2026-06-04
**Updated:** 2026-06-04
**Goal:** Detect DeepSeek/Anthropic prompt-cache collapse by input-token trends, avoid blocking the processor loop, notify users, and reset cache-collapse state for rebaseline.

## Abstract Definition

Let `K = sessionID:agent:modelID` key the processor-local cache health state.

```text
input_delta = current_input_tokens - previous_input_tokens
collapsed = input_delta > 100000
poisoned = two consecutive collapsed turns
rebaseline = poisoned -> notify + reset K, never block the prompt loop
```

## Execution Flow

```text
SessionProcessor.process
  -> finish-step usage
  -> trackCachePoison(K, tokens)
  -> if collapsed: log diagnostic data
  -> if poisoned:
       set handle.needsCacheRebaseline
       publish Session.Event.CacheCollapsed

SessionPrompt.loop
  -> handle.process(...)
  -> if handle.needsCacheRebaseline:
       resetCachePoisonState(K)
       continue normal loop

TUI session route
  -> event.on("session.cache_collapsed")
  -> show non-blocking toast for active session
```

## Tasks

### Task 1: Replace Ratio-Based Collapse Detection

**Files:** `packages/opencode/src/session/processor.ts`, `packages/opencode/test/session/processor-effect.test.ts`

- [x] Track `previousInputTokens` per cache key.
- [x] Detect collapse with `input_delta > 100000`.
- [x] Keep `cacheRatio()` as diagnostic data only.
- [x] Log `"bug: cold cache cost"` for cold starts with `input > 100000`.
- [x] Add/adjust processor tests for small delta, large delta, cold start, reset, and poison threshold.

### Task 2: Rebaseline Instead Of Blocking

**Files:** `packages/opencode/src/session/processor.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/session.ts`

- [x] Add `needsCacheRebaseline` to `ProcessorContext`.
- [x] Expose `needsCacheRebaseline` through `SessionProcessor.Handle`.
- [x] Add `resetCachePoisonState(key)` export.
- [x] Set `needsCacheRebaseline` when two consecutive collapses poison the cache state.
- [x] Publish `Session.Event.CacheCollapsed` with session/model/token details.
- [x] Consume `handle.needsCacheRebaseline` in `prompt.ts` and reset the key.
- [x] Do not set `ctx.blocked` for cache poisoning.

### Task 3: DeepSeek Cache Markers

**File:** `packages/opencode/src/provider/transform.ts`

- [x] Add DeepSeek provider/model/API checks to the `applyCaching()` gate.
- [x] Preserve existing provider cache-marker behavior for Anthropic, OpenAI-compatible, Alibaba, OpenAI, Azure, and Copilot.

### Task 4: User-Visible Notification

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

- [x] Subscribe to `session.cache_collapsed` for the active session.
- [x] Show a non-blocking toast with model and resent-token details.

### Task 5: Diagnostic Logging

**File:** `packages/opencode/src/session/processor.ts`

- [x] Log `inputDelta`, normalized token counts, and raw `inputTokenDetails` when collapse/poison is detected.
- [x] Log high-input cold starts.

### Task 6: Stream Progress Watchdog

**Status:** partially implemented in `20260604_stream_stall_cache_poisoning_plan.md`

- [x] Add conservative processor timeout for stalled streams.
- [x] Return `"stalled"` for pre-tool stalls and auto-continue from `SessionPrompt`.
- [x] Treat post-tool stalls as `"stop"` to avoid duplicate tool execution.
- [ ] Add reliable targeted runtime tests for watchdog behavior.

## Verification

- [x] Regenerate JS SDK after adding `session.cache_collapsed` to the event surface.
- [x] Run `bun typecheck` from `packages/opencode`.
- [x] Run focused processor tests.
- [x] Run provider transform tests.

## Notes

- The cache-collapse fix is intentionally provider-neutral: it detects sudden input-token spikes rather than relying on provider-specific cache read/write semantics.
- Stream stall recovery remains out of scope for this cache-collapse implementation.
