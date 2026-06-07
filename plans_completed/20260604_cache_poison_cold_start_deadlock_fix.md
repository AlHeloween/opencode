# Cache Poison Cold-Start Detection Fix

**Status:** complete
**Created:** 2026-06-04
**Updated:** 2026-06-04
**Goal:** Fix `trackCachePoison()` state machine so that cache-collapse and persistent-cold scenarios trigger rebaseline even when cache was never proven "healthy" (0.85 ratio). Add per-message cache ratio logging to DB.

## Verification
- [x] `bun typecheck` passes from `packages/opencode`
- [x] 8/8 cache poison unit tests pass (`bun test -t "cache poison"`)
- [x] 6 new tests added covering: cold-start collapse, cold-start poison, persistent cold, healthy reset, negative delta baseline reset

## Root Cause (confirmed by diagnostic script)

The `trackCachePoison()` function at `processor.ts:115-187` gates all collapse/poison detection behind a `state.healthy` precondition. This flag is set only when `ratio >= 0.85`:

```text
ratio = cacheReadTokens / max(1, inputTokens + cacheReadTokens + cacheWriteTokens)
```

In sessions with large message histories (300K-500K input tokens), the cacheable system-prompt prefix is a fixed ~2K tokens. The ratio ceiling is:

```text
2,000 / (300,000 + 2,000) = 0.0066   (128× below 0.85 threshold)
```

The `state.healthy` flag **never** becomes `true`. The cold-start branch at line 142 returns `{collapsed: false, poisoned: false}` on every turn, permanently blocking the collapse check at line 162. `needsCacheRebaseline` is never set, and the rebaseline at `prompt.ts:1335` never fires.

### Confirmed by Aurora_Python session `ses_17a0f41bfffeBZjje8v2nVLM7i`:

| Turn | agent | inputTokens | cacheRead | ratio | state.healthy | Action |
|------|-------|------------|-----------|-------|---------------|--------|
| 0 | plan | 489,913 | 1,792 | 0.0036 | false | COLD START [blocked] |
| 1 | compaction | 335,371 | 1,792 | 0.0053 | false | COLD START [blocked] |
| 2 | plan | 17,350 | 9,984 | 0.3653 | false | COLD START [blocked] |

## Additional Gaps Found

1. **Negative delta between Turn 0 and Turn 2:** `delta = -472,563`. Even if the healthy gate were removed, the current collapse detection only triggers on `inputDelta > 100,000` (positive). A shrinking context after a huge request is silently ignored.

2. **No persistent-cold detection:** After N consecutive cold-start warnings with no improvement, the system should recognize "this cache is permanently ineffective" and force a rebaseline. Currently it logs `"bug: cold cache cost"` and moves on indefinitely.

3. **`checkSystemStability()` is log-only:** In `llm.ts:55-69`, system-prompt hash changes are detected and logged at ERROR level but never wire into the rebaseline mechanism. A hash change means the provider's cached prefix is definitively invalid.

4. **`previousInputTokens` persists across huge context shifts:** When Turn 0 has 489K input and Turn 2 has 17K input, the `previousInputTokens` (489K) is carried forward. The next request with 300K+ input will compute `delta = 300K - 17K = 283K` — a false positive collapse, since the baseline was the 17K "small" turn, not the earlier 489K "large" turn.

## Abstract Definition

Let `K = sessionID:agent:modelID` key the processor-local cache health state. Extend the state machine with two new escape paths:

```text
State variables:
  healthy: bool
  collapsed: int
  poisoned: bool
  previousInputTokens: number | undefined
  consecutiveCold: int           ← NEW: persistent-cold counter
  lastSignificantInput: number | undefined  ← NEW: high-water-mark tracking

Decision tree (additions in UPPERCASE):

1. ratio >= 0.85:
   → HEALTHY: reset all state (as before)

2. !state.healthy:
   a. If inputDelta > 0 AND inputDelta > 100_000:
      → COLLAPSE FROM COLD: increment collapsed, treat as collapse
      → If collapsed >= 2: POISONED → rebaseline
   b. If input > 100_000 AND ratio < 0.1:
      → COLD START: increment consecutiveCold
      → If consecutiveCold >= 3: POISONED → rebaseline
   c. If inputDelta < -100_000 (context shrank dramatically):
      → RESET BASELINE: previousInputTokens = currentInput (avoid false positives)

3. state.healthy (existing path, unchanged):
   → collapse detection via inputDelta > 100_000
```

## Tasks

### Task 1: Remove healthy gate for positive-delta collapse detection

**Files:** `packages/opencode/src/session/processor.ts`

- [ ] In the `!state.healthy` branch (line 142), before returning, check `inputDelta > 0 && inputDelta > CACHE_INPUT_DELTA_THRESHOLD`.
- [ ] If delta spike detected from cold: increment `state.collapsed`, check poison threshold, set `needsCacheRebaseline` if poisoned.
- [ ] Log `"bug: prompt cache collapsed from cold start"` with diagnostic data.

### Task 2: Add persistent-cold counter

**Files:** `packages/opencode/src/session/processor.ts`

- [ ] Add `consecutiveCold: number` to `CachePoisonState`.
- [ ] In the cold-start branch: when `input > CACHE_COLD_START_INPUT_THRESHOLD` AND `ratio < 0.1`, increment `consecutiveCold`.
- [ ] If `consecutiveCold >= 3`: treat as poisoned, set `needsCacheRebaseline`, log `"bug: persistent cold cache — forcing rebaseline"`.
- [ ] Reset `consecutiveCold` on any healthy ratio or after rebaseline.
- [ ] Add `CACHE_PERSISTENT_COLD_THRESHOLD = 3` constant.

### Task 3: Reset baseline on negative inputDelta (context shrinkage)

**Files:** `packages/opencode/src/session/processor.ts`

- [ ] When `inputDelta < -CACHE_INPUT_DELTA_THRESHOLD` (context shrank >100K): reset `previousInputTokens = currentInput`.
- [ ] This prevents false-positive collapse on the next request when input grows back to normal size.
- [ ] Log `"bug: input context shrank — resetting cache baseline"` at debug level.

### Task 4: Wire checkSystemStability into rebaseline

**Files:** `packages/opencode/src/session/llm.ts`, `packages/opencode/src/session/processor.ts`

- [ ] Export a `resetSystemStabilityKey(key)` function from `llm.ts` that deletes the hash entry.
- [ ] In `checkSystemStability()`: when hash change is detected, also call `SessionProcessor.resetCachePoisonState(key)` to force rebaseline.
- [ ] This ensures system-prompt content changes immediately invalidate the poisoned cache state rather than relying on input-delta detection.

### Task 5: Add/update tests

**Files:** `packages/opencode/test/session/processor-effect.test.ts`

- [ ] Test: "cold-start positive delta >100K triggers collapse"
- [ ] Test: "two consecutive cold-start collapses trigger poison"
- [ ] Test: "three consecutive cold starts with large input trigger persistent-cold poison"
- [ ] Test: "persistent-cold counter resets after healthy ratio"
- [ ] Test: "negative delta resets baseline, no false-positive collapse"
- [ ] Test: "consecutiveCold counter resets on ratio improvement (even if not healthy)"

### Task 6: Verification

- [ ] Run `bun test test/session/processor-effect.test.ts` from `packages/opencode`
- [ ] Run `bun typecheck` from `packages/opencode`
- [ ] Run diagnostic script against Aurora_Python session to confirm state machine now reaches poison on same data

## Execution Flow (after fix)

```text
SessionProcessor.process
  → finish-step usage
  → trackCachePoison(K, tokens)
      → ratio >= 0.85? → HEALTHY, done
      → !healthy?
          → delta > 100K? → COLLAPSED → if 2x: POISONED → rebaseline
          → cold + large input? → increment consecutiveCold
              → consecutiveCold >= 3? → PERSISTENT COLD POISON → rebaseline
          → delta < -100K? → RESET BASELINE
          → else: cold warning (existing)
      → healthy?
          → delta > 100K? → COLLAPSED (existing)
          → else: NORMAL
  → if poisoned:
       set handle.needsCacheRebaseline
       publish Session.Event.CacheCollapsed

SessionPrompt.loop
  → handle.process(...)
  → if handle.needsCacheRebaseline:
       resetCachePoisonState(K)
       continue normal loop
```

## Notes

- The 0.85 healthy ratio is preserved as the "gold standard" healthy indicator. The fix adds alternate paths to reach poisoned/rebaseline without it.
- Persistent-cold detection uses `ratio < 0.1` (not 0.85) as the cold-signal threshold — much more achievable for large sessions.
- The `CACHE_PERSISTENT_COLD_THRESHOLD = 3` is conservative: 3 consecutive cold turns before forcing rebaseline gives the provider cache a fair chance to warm up.
- `checkSystemStability` wiring is defense-in-depth: if the system prompt hash changes, we KNOW the cache is invalid regardless of token deltas.
