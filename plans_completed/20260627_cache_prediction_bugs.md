---
status: done
owner: codex
created: 2026-06-27
reproduce:
  - cd packages/opencode && bun typecheck
  - Start opencode with `opencode` provider model that supports KV caching
  - Observe first turn (title agent) → second turn (build agent)
  - Log should show "cache miss" for turn 2, NOT "bug: cache miscalculation"
---

# Emergency: Cache Prediction Bugs (3 issues)

## Goal

Fix three related bugs in the KV cache prediction system discovered via debug experiment at `experiments/20260626_cache_break_debug/`.

## Summary

| # | Bug | Severity | File |
|---|-----|----------|------|
| 1 | Fingerprint storage key lacks agent name | HIGH | `cache-control.ts` |
| 2 | Wrong cache warmth prediction logic | HIGH | `processor.ts` |
| 3 | System prompt changes mid-session (checkpoint mismatch) | MEDIUM | `prompt.ts` |

## Evidence

```
Debug experiment: experiments/20260626_cache_break_debug/
Model: nemotron-3-ultra-free via opencode provider
Session: ses_0f915c385ffeL7WyCWeDU4xDsA
```

### Log entries (from model JSONL)

```
Turn 1 (title agent): cache miss — cacheRatio: 0, inputTokens: 17254
Turn 2 (build agent): cache miss — cacheRatio: 0, inputTokens: 18331
  "bug: cache miscalculation" — predicted: warm, actual: cold
  "bug: system prompt content changed mid-session" — diffLine: 11
Turn 3 (build agent): cache miss — cacheRatio: 0, inputTokens: 18943
  "bug: cache miscalculation" — predicted: warm, actual: cold
```

---

## Bug 1: Fingerprint Key Lacks Agent Name

### Problem

Fingerprint storage key is `${sessionID}:${modelID}` but provider cache key is `${sessionID}:${agentName}:${modelID}`. Title agent stores a fingerprint, build agent loads it — mismatched system prompts.

### Location

`src/session/cache-control.ts:234`

```typescript
function cacheStoreKey(sessionId: string, modelId: string): string {
  return `${sessionId}:${modelId}`
}
```

### Fix

Change `cacheStoreKey` to accept and include `agentName`:

```typescript
function cacheStoreKey(sessionId: string, modelId: string, agentName?: string): string {
  return agentName ? `${sessionId}:${agentName}:${modelId}` : `${sessionId}:${modelId}`
}
```

Update all callers:
- `storePrevFingerprint(sessionId, modelId, fp)` → `storePrevFingerprint(sessionId, modelId, fp, agentName)`
- `getPrevFingerprint(sessionId, modelId)` → `getPrevFingerprint(sessionId, modelId, agentName)`

### Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| T1.1 | Fingerprint stored by title agent is NOT loaded by build agent | `getPrevFingerprint` returns null for different agent |
| T1.2 | Fingerprint stored by build agent IS loaded by build agent | `getPrevFingerprint` returns stored fingerprint |
| T1.3 | Existing sessions without agent in key still work | Backward compat: fallback to `${sessionId}:${modelId}` |

---

## Bug 2: Wrong Cache Warmth Prediction

### Problem

```typescript
// processor.ts:508
const predictedWarm = prevFP.estimatedTokens > 0
```

This checks "did we have tokens before?" — not "will the provider have a cached prefix?" It's wrong in two cases:
1. Agent switch (different provider cache key)
2. System prompt change (different fingerprint)

### Location

`src/session/processor.ts:506-519`

### Fix

Replace the prediction with fingerprint comparison:

```typescript
const prevFP = CacheControl.getPrevFingerprint(ctx.sessionID, ctx.model.id, agentName)
if (prevFP) {
  // Build current fingerprint to compare
  const currentFP = CacheControl.requestFingerprint(system, messages, meta, toolSchemas)
  const predictedWarm = prevFP.fullMd5 === currentFP.fullMd5
  if (predictedWarm !== cacheWarm) {
    log.warn("bug: cache miscalculation", { ... })
  }
}
```

Alternatively, simpler: check if the system prompt hash changed (which invalidates the provider cache):

```typescript
const predictedWarm = prevFP.systemMd5 === currentSystemMd5 && prevFP.messages.length <= messages.length
```

### Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| T2.1 | Agent switch → prediction is "cold" | `predictedWarm = false` |
| T2.2 | Same agent, same system, new message → prediction is "warm" | `predictedWarm = true` if provider supports caching |
| T2.3 | System prompt changed → prediction is "cold" | `predictedWarm = false` |

---

## Bug 3: System Prompt Changes Mid-Session

### Problem

Turn 2 (build agent) system prompt had `[session: ses_xxx]` at line 11 (length 4614).
Turn 3 (build agent) system prompt didn't have it (length 4615).

The checkpoint saved after turn 2 included the session line. On turn 3, `checkpointUsable` was `false`, so the system was rebuilt from scratch without the session line.

### Location

`src/session/prompt.ts` — checkpoint load/save logic (~lines 1599-1630, 1772-1799)

### Possible Causes

1. `checkpointHasStructuredPrompt` mismatch between save and load
2. Checkpoint version mismatch
3. Model/provider mismatch between save and load
4. Agent mismatch between save and load (title agent saved checkpoint, build agent tried to load it)

### Investigation

Check if the checkpoint saved by the title agent is being loaded by the build agent (same session, same model, different agent). If checkpoint includes the agent name in its lookup key, this shouldn't happen. If it doesn't — that's another bug.

### Location for agent in checkpoint

`src/session/checkpoint.ts` — the `Checkpoint.load()` function

### Fix

Ensure checkpoint load uses agent-aware keying, or that `checkpointUsable` accounts for agent mismatch.

---

## Dependencies

```
Bug 1 (fingerprint key) ← independent
Bug 2 (prediction logic) ← depends on Bug 1 (needs agent name for fingerprint lookup)
Bug 3 (checkpoint mismatch) ← independent, but may be related to Bug 1
```

## Recommended Execution Order

1. Fix Bug 1 (fingerprint key) — foundation for correct prediction
2. Fix Bug 2 (prediction logic) — depends on Bug 1
3. Investigate Bug 3 (checkpoint) — may require exploring checkpoint.ts

## Oracle Gates

- [x] `bun typecheck` passes with zero errors
- [x] All callers updated
- [ ] Cache debug experiment shows correct behavior (requires runtime verification)
