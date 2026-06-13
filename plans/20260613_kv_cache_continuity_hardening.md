# KV Cache Continuity Hardening Plan

**Date:** 2026-06-13  
**Status:** Validated (explore agent corrections applied)  
**Priority:** Medium  

## Abstract

Three cache continuity glitches identified during codebase audit. Fix them in priority order:
plugins modifying system prompt post-fingerprint, compaction path skipping fingerprint,
and text fingerprint using length rather than content hash.

---

## Task 1: Store Fingerprint After Plugin Hook (Not Before)

**File:** `src/session/prompt.ts`, normal processing path (~line 1451-1461)

**Problem:** The fingerprint is computed and stored BEFORE `handle.process()` is called.
The `experimental.chat.system.transform` plugin hook in `llm.ts:176` receives the `system` array
**by reference**. If a plugin modifies `system` (e.g., `system.push("...")`), the original array
in `prompt.ts` is also modified. But the fingerprint was already computed on the pre-plugin content.
Next turn sees the stored fingerprint, compares against the unmodified original → false `cacheStable`.

**Key insight from validation:** `system` is passed by reference through the entire chain:
```
prompt.ts → processor.ts → llm.ts
```
The plugin in `llm.ts` modifies the same array object. After `handle.process()` returns,
`system` in `prompt.ts` already reflects the plugin's changes. No API restructuring needed.

**Current flow:**
```
prompt.ts:
  1. Build system
  2. Compute fingerprint from system + msgs
  3. Store fingerprint via storePrevFingerprint()   ← STALE if plugin modifies system
  4. Call handle.process({ ..., system })
     → llm.ts: plugin trigger modifies system in-place
```

**Fix:** Keep the pre-call fingerprint for `modelMsgsCache` reuse (current step optimization).
Move `storePrevFingerprint()` to AFTER `handle.process()` so the stored fingerprint reflects
the ACTUAL system that was sent to the provider.

```
prompt.ts:
  1. Build system
  2. Compute fingerprint → audit cache, reuse modelMsgsCache (current step only)
  3. Call handle.process({ ..., system })
     → llm.ts: plugin trigger modifies system in-place
  4. Compute fingerprint from (potentially modified) system + msgs
  5. Store fingerprint via storePrevFingerprint()   ← ACCURATE for next turn
```

**Code change** in `prompt.ts` normal path, after `handle.process()` returns:
```typescript
// After handle.process() returns, system may have been modified by plugin.
// Compute and store the actual fingerprint for next-turn comparison.
const finalFP = CacheControl.requestFingerprint(system, msgs, {
  sessionId: sessionID,
  modelId: model.id,
  providerId: model.providerID,
})
CacheControl.storePrevFingerprint(sessionID, model.id, finalFP)
```

And REMOVE the `storePrevFingerprint()` call that currently precedes `handle.process()`.
Keep the pre-call `requestFingerprint()` + `auditCache()` for `modelMsgsCache` reuse.

**Input:** `system`, `msgs` after `handle.process()` completes  
**Output:** Accurate fingerprint stored for next-turn comparison.

---

## Task 2: Store Fingerprint in Compaction Path + Invalidate modelMsgsCache

**File:** `src/session/prompt.ts`, compaction block (~line 1250)

**Problem:** The compaction path calls `handle.process()` but never computes or stores a cache
fingerprint. When the next normal turn starts, `getPrevFingerprint()` returns a stale value from
the pre-compaction turn, and the audit reports `cacheStable: false`. This is a false cache break.

**Additional gap (from validation):** The `modelMsgsCache` variable is set only in the normal path
(line 1471-1472). After compaction completes, the next normal turn would try to reuse
`modelMsgsCache` which contains pre-compaction converted messages — stale data. Must also
invalidate `modelMsgsCache` after compaction.

**Fix:** Add fingerprint computation AND modelMsgsCache invalidation to the compaction path:

```typescript
// In compaction block, after system construction and before handle.process():
const currentFP = CacheControl.requestFingerprint(system, msgs, {
  sessionId: sessionID,
  modelId: model.id,
  providerId: model.providerID,
})
CacheControl.storePrevFingerprint(sessionID, model.id, currentFP)

// After compaction outcome, invalidate modelMsgsCache so the next normal
// turn doesn't reuse stale converted messages from before compaction:
modelMsgsCache = undefined
```

**Input:** System + msgs from compaction turn  
**Output:** Fingerprint stored for next-turn baseline; modelMsgsCache cleared.

---

## Task 3: Hash Text Content in Text Fingerprint

**File:** `src/session/cache-control.ts`, `partFingerprint` function (~line 69)

**Problem:** The fingerprint for text parts uses `part.text.length`:
```typescript
return `t:${part.id}:${part.text.length}:${part.ignored ? 1 : 0}`
```

Two different texts of the same byte-length will produce identical fingerprints. If a user
edits a message to have the same length but different meaning, the fingerprint won't catch it.

**Validated:** `md5()` is already defined in the file (line 60-62) via `createHash("md5")`.
No new imports needed. MD5 of 1024 chars is ~0.1ms — negligible vs LLM latency.

**Fix:** Use `md5(part.text.slice(0, 1024))` instead of `part.text.length`:

```typescript
const textHash = md5(part.text.slice(0, 1024))  // first 1KB is representative
return `t:${part.id}:${textHash}:${part.ignored ? 1 : 0}`
```

Empty text: `md5("")` → `d41d8cd98f00b204e9800998ecf8427e` — valid, distinct fingerprint.

**Input:** Text part content  
**Output:** Content-based hash instead of length-based fingerprint

---

## Verification

- [ ] `bun typecheck` from `packages/opencode` passes
- [ ] `bun test test/session/compaction.test.ts` from `packages/opencode` passes
- [ ] `bun test test/session/cache-control.test.ts` from `packages/opencode` passes (or manual fingerprint verification)
- [ ] Manual: verify cache audit shows `cacheStable: true` for post-compaction turns
- [ ] Manual: verify fingerprint changes when text content changes (same length, different text)
- [ ] No new `log.warn("bug: ...")` entries related to cache
