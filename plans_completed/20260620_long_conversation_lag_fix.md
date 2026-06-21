# Long Conversation Lag Fix Plan

**Date**: 2026-06-20  
**Status**: planning  
**Problem**: ~45-90 second delays between turns in long conversations (5000+ messages), caused by O(n) operations re-executed every loop iteration.

---

## Root Cause Analysis

For a 5,000-message conversation with no compaction boundary, every `runLoop` iteration executes:

| Operation | Complexity | Est. Time |
|-----------|-----------|-----------|
| `filterCompactedEffect` DB pagination (20 queries) | O(n/500) DB round-trips | ~30s |
| `requestFingerprint` × 2 (30,000 MD5 computations) | O(total_parts) | ~10s |
| `toModelMessagesEffect` (message conversion) | O(n × parts) | ~10s |
| `auditCache` (fingerprint comparison) | O(n) | ~5s |
| Tool/skill resolution | O(tools) | ~5s |

Total: ~60s per turn MINUS model inference time. The user perceives this as "model lag."

### The feedback loop makes it worse

Each tool-use loop re-executes ALL operations from scratch, even though the underlying filtered messages haven't changed — only new tool-results are appended.

---

## Master Plan

### Goal 1: Eliminate redundant `filterCompactedEffect` within runLoop

**SV**: cache, filterCompactedEffect, runLoop, message-loading, DB-query, pagination, sqlite, compaction-boundary, incremental
**Done**: 0%

#### Task 1.1: Cache filtered messages within a single runLoop

**Abstract definition**: Within a single `runLoop` execution, the result of `filterCompactedEffect` is deterministic and immutable — no new compaction boundaries are created and old messages don't change. Only NEW messages (tool results, assistant responses) are appended during the loop. Cache the initial filtered set and incrementally append new messages.

**Math formalization**:
Let M = set of all messages in session S at time t₀
Let C(M) = {m ∈ M | m is not before compaction boundary} be the filtered set
Let Δₖ = {messages appended between loop iteration k-1 and k}

For iteration k > 0:
  C'(M, k) = C(M) ∪ Δ₁ ∪ Δ₂ ∪ ... ∪ Δₖ
  where C(M) is cached from iteration 0

Correctness invariant: ∀k, C'(M, k) ⊇ C(M) and messages in C(M) remain immutable.

**Structural diagram**:
```
runLoop iteration 0:
  msgs = filterCompactedEffect(sessionID)  // full DB query
  cachedMsgs = msgs
  lastKnownId = msgs[last].info.id

runLoop iteration k > 0:
  newMsgs = messagesSince(sessionID, lastKnownId)  // incremental DB query
  msgs = [...cachedMsgs, ...newMsgs]
  cachedMsgs = msgs  // update cache
  lastKnownId = msgs[last].info.id
```

**Input parameters**:
- `sessionID: SessionID`
- `cachedMsgs: WithParts[]` (internal accumulator)
- `lastKnownId: string` (cursor for incremental fetch)

**Output**: `WithParts[]` — full filtered message list

**Brief implementation**:
1. In `prompt.ts` `runLoop()` (line 1122), add two state variables before the while loop:
   - `let cachedMsgs: WithParts[] | undefined`
   - `let lastKnownId: string | undefined`
2. Replace `let msgs = yield* MessageV2.filterCompactedEffect(sessionID)` with:
   - On first call: store result in `cachedMsgs`, set `lastKnownId`
   - On subsequent calls: call a new lightweight `MessageV2.messagesSince(sessionID, lastKnownId)`, append to `cachedMsgs`
3. On `break` from loop: clear cache so next turn starts fresh

**Test cases**:
- [ ] Single-turn conversation: cache created once, normal behavior
- [ ] Multi-step tool use (3 tool calls): cache created once, 2 incremental fetches, correct message order
- [ ] Error in tool call: cache persists across error recovery
- [ ] Overflow triggers compaction: cache invalidated, next iteration re-runs full filterCompactedEffect
- [ ] 5000 messages + 0 compaction: first call takes O(n), subsequent calls take O(1)

---

#### Task 1.2: Add `messagesSince` lightweight query

**Abstract definition**: A minimal DB query that fetches only messages created after a given message ID, with parts hydrated, for appending to the cached filtered set.

**Math formalization**:
Let last_id be the ID of the last message in the cached set.
Query: SELECT messages WHERE session_id = S AND id > last_id ORDER BY time_created ASC

**Input**: `{ sessionID: SessionID, after: string }`
**Output**: `WithParts[]` — messages newer than `after`

**Brief implementation** (in `message-v2.ts`):
```typescript
export function messagesSince(sessionID: SessionID, after: string): WithParts[] {
  const rows = Database.use((db) =>
    db.select().from(MessageTable)
      .where(and(eq(MessageTable.session_id, sessionID), gt(MessageTable.id, after)))
      .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
      .all()
  )
  return hydrate(rows)
}
```

**Test cases**:
- [ ] Empty result when no new messages
- [ ] Returns 1 message when 1 tool result appended
- [ ] Returns multiple messages in correct chronological order
- [ ] Parts hydrated correctly for new messages

---

### Goal 2: Add fast compaction-boundary existence check

**SV**: compaction-boundary, existence-check, index, filterCompactedEffect, early-exit, sqlite, partial-index, boolean-flag
**Done**: 0%

#### Task 2.1: Add `has_compaction_boundary` check before pagination

**Abstract definition**: Before paginating through all messages to find a compaction boundary, run a single lightweight query to check if a compaction boundary even exists. If no boundary exists, fall back to a single batch-load of all messages (avoid per-page round-trips).

**Math formalization**:
Let E(S) = boolean, true if session S has any compaction-part message
If E(S) = false: load all messages in one query (no need to paginate for boundary)
If E(S) = true: existing filterCompactedEffect pagination logic applies

**Structural diagram**:
```
filterCompactedEffect(sessionID):
  if (!hasCompactionBoundary(sessionID)):
    return loadAllMessages(sessionID)  // single query, no pagination
  else:
    return existingPaginationLogic()    // stop at boundary
```

**Input**: `sessionID: SessionID`
**Output**: `boolean` — true if at least one compaction-part message exists

**Brief implementation**:
1. Create Drizzle schema addition in `session.sql.ts`:
   - Option A: Add `has_compaction: integer` column to MessageTable with a partial index
   - Option B (simpler): Query for compaction parts via PartTable:
     ```sql
     SELECT 1 FROM part 
     WHERE session_id = ? AND type = 'compaction'
     LIMIT 1
     ```
   - Prefer Option B since it requires no migration and the PartTable already has `part_session_idx` on `(session_id)`

2. In `filterCompactedEffect` (`message-v2.ts:1199`):
   ```typescript
   const hasCompactionPart = Database.use((db) =>
     db.select({ one: sql`1` }).from(PartTable)
       .where(and(
         eq(PartTable.session_id, sessionID),
         eq(PartTable.type, "compaction")
       ))
       .limit(1)
       .all()
   ).length > 0
   if (!hasCompactionPart) {
     // Fast path: load all messages in one query
     const allRows = Database.use((db) =>
       db.select().from(MessageTable)
         .where(eq(MessageTable.session_id, sessionID))
         .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
         .all()
     )
     return hydrate(allRows)
   }
   // Slow path: existing pagination logic with compaction boundary detection
   ```

**Test cases**:
- [ ] No compaction boundary: single query, returns all messages correctly
- [ ] Compaction boundary exists: uses existing pagination, stops at boundary
- [ ] Compaction boundary + tail_count: pagination loads tail messages correctly
- [ ] Empty session: returns empty array, no error

---

### Goal 3: Eliminate redundant `requestFingerprint` computation

**SV**: cache, requestFingerprint, MD5, kv-cache, deduplication, cache-control, runLoop  
**Done**: 0%

#### Task 3.1: Cache first fingerprint call result for reuse

**Abstract definition**: `requestFingerprint` is called twice per normal turn (lines 1538 and 1578 in prompt.ts) with the same `msgs` and `system` — compute once and reuse.

**Math formalization**:
At lines 1538 and 1578 in a single loop iteration:
  fp₁ = requestFingerprint(system, msgs, meta, toolSchemas)  // line 1538
  fp₂ = requestFingerprint(system, msgs, meta, toolSchemas)  // line 1578
  fp₁ ≡ fp₂ (same inputs, deterministic computation)

**Implementation**: Store `currentFP` from line 1538 and reuse at line 1578-1583. The only difference between the two calls is that line 1578 uses different tool schemas — verify this in code. If the tool schemas are identical (they should be within a single turn), simple variable reuse works.

**Brief implementation** (in `prompt.ts` around lines 1538-1583):
```typescript
const currentFP = CacheControl.requestFingerprint(system, msgs, {
  sessionId: sessionID, modelId: model.id, providerId: model.providerID,
}, CacheControl.toolSchemasFromRecord(tools))

// ... use currentFP here ...

// Instead of recomputing at line 1578:
const finalFP = currentFP  // reuse; same system, msgs, model, tools within a turn
CacheControl.storePrevFingerprint(sessionID, model.id, finalFP)
```

**Test cases**:
- [ ] currentFP === finalFP when no system/message changes occur between lines
- [ ] Plugin transforms modify system: verify finalFP captures changes
- [ ] Cache stability audit doesn't break

---

### Goal 4: Tool and skill resolution caching

**SV**: cache, tool-resolution, skill-resolution, MCP, runLoop, plugin-hook, tool-definition  
**Done**: 0%

#### Task 4.1: Cache tool resolution result within runLoop

**Abstract definition**: Tool resolution (`SessionTools.resolve` at prompt.ts:1441) is called every loop iteration and iterates through all registered tools + MCP tools. Cache the resolved tools map since the set of available tools doesn't change during a single turn.

**Brief implementation**:
1. In `prompt.ts` `runLoop()`, cache the resolved tools:
```typescript
let cachedTools: ReturnType<typeof SessionTools.resolve> | undefined
// ...
if (!cachedTools) {
  tools = yield* SessionTools.resolve({ model, agent, sessionID, ... })
  cachedTools = tools
} else {
  tools = cachedTools
}
```

**Test cases**:
- [ ] Tools resolved once per runLoop, reused for all iterations
- [ ] Error in tool resolution: cache not created, retries next iteration

---

### Goal 5: Documentation and verification

**SV**: documentation, verification, oracle, test-coverage, benchmark, measurement  
**Done**: 0%

#### Task 5.1: Add performance instrumentation

Add timing logs to measure the duration of each bottleneck before and after fixes:
```typescript
const t0 = performance.now()
const msgs = yield* MessageV2.filterCompactedEffect(sessionID)
log.debug("filterCompactedEffect duration", { ms: performance.now() - t0, msgCount: msgs.length })
```

#### Task 5.2: Create integration test for long conversations

Create a test that simulates a 5000-message conversation and measures:
- [ ] filterCompactedEffect duration < 200ms
- [ ] requestFingerprint duration < 50ms  
- [ ] Total pre-model overhead < 500ms

#### Task 5.3: Verify no regression in compaction behavior

Run existing compaction tests:
- [ ] `bun test` in packages/opencode for compaction-related tests
- [ ] Manual test: create session → long conversation → compaction trigger → verify messages truncated correctly

---

## Summary

| Goal | Task | Complexity | Risk | Expected Improvement |
|------|------|------------|------|---------------------|
| G1 | T1.1 Cache filterCompactedEffect | Low | Medium (correctness) | -80% DB queries per turn |
| G1 | T1.2 messagesSince query | Low | Low | Enables T1.1 |
| G2 | T2.1 hasCompaction check | Medium | Medium (schema change) | -90% DB queries for no-boundary sessions |
| G3 | T3.1 Reuse fingerprint | Low | Low | -50% MD5 computation |
| G4 | T4.1 Cache tool resolution | Low | Low | -80% tool resolution overhead |
| G5 | T5.1-5.3 Verification | Medium | Low | Regression safety net |

**Target**: Reduce ~60s pre-model overhead to <2s for 5000-message conversations.
