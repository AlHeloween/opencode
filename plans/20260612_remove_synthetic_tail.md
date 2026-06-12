# Remove Synthetic Tail Message Creation from Compaction

**Date:** 2026-06-12  
**Status:** Plan (pending validation)  
**Priority:** Medium

---

## Abstract

Eliminate the synthetic tail message creation in `processCompaction` by teaching `filterCompactedEffect` to include the original tail messages naturally. Instead of copying tail messages as new DB rows after the compaction boundary, store the tail message count on the `CompactionPart` and adjust the boundary detection to continue past the boundary for exactly that many messages.

**Goal**: Remove ~65 lines of fragile copy logic (`compaction.ts:504-554`), close the "summary persisted, tail lost" partial-persistence gap, and reduce DB writes per compaction.

---

## Current Mechanism (What Gets Removed)

```
Messages in DB (chronological):
  [...head...] [tail_1] [tail_2] [compaction_user] [summary_assistant] [syn_tail_1] [syn_tail_2]
                                        ^
                                   boundary here
```

`filterCompactedEffect` walks newest-first. When it hits `compaction_user` (boundary), it breaks. Messages `syn_tail_1` and `syn_tail_2` are included (they're newer), but `tail_1` and `tail_2` (the originals) are excluded (they're older than the boundary). Hence the synthetic copies.

## Proposed Mechanism

```
Messages in DB (chronological):
  [...head...] [tail_1] [tail_2] [compaction_user] [summary_assistant]
                                        ^
                                   boundary here
                              + tail_count = 2 stored on CompactionPart
```

`filterCompactedEffect` walks newest-first. When it hits `compaction_user` (boundary), it checks `CompactionPart.tail_count`. If > 0, it CONTINUES iterating for exactly `tail_count` more messages (the original tail), then breaks. The original `tail_1` and `tail_2` are included. No copies needed.

**Key insight**: The tail messages are ALREADY in the same DB page as the boundary (page size = 500, tail budget ≤ 10K tokens ≡ at most a few dozen messages). The iteration order within a page is newest-first, so the tail messages are at lower indices (older) than the boundary -- we just need to not break immediately.

---

## File-Level Changes

### File 1: `packages/opencode/src/session/message-v2.ts`

#### 1a. CompactionPart schema (lines 225-233)

Add `tail_count` field:

```diff
 export const CompactionPart = Schema.Struct({
   ...partBase,
   type: Schema.Literal("compaction"),
   auto: Schema.Boolean,
   overflow: Schema.optional(Schema.Boolean),
+  tail_count: Schema.optional(Schema.Number).annotate({
+    description: "Number of original tail messages after the compaction boundary to preserve verbatim. Eliminates need for synthetic copies."
+  }),
 })
```

#### 1b. `filterCompactedEffect` (lines 1154-1185)

Change from immediate `break outer` to conditional continued collection:

```diff
 export const filterCompactedEffect = Effect.fnUntraced(function* (sessionID: SessionID) {
   const size = 500
   let before: string | undefined
   const result: WithParts[] = []
   const completed = new Set<string>()
+  let tailRemaining = 0

   outer: while (true) {
     const next = page({ sessionID, limit: size, before })
     if (next.items.length === 0) break

     for (let i = next.items.length - 1; i >= 0; i--) {
       const msg = next.items[i]!
       result.push(msg)
-      if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish)
+      if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish) {
         completed.add(msg.info.parentID)
+      }
-      if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction"))
-        break outer
+      if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction")) {
+        const compactionPart = msg.parts.find((part) => part.type === "compaction") as CompactionPart | undefined
+        tailRemaining = compactionPart?.tail_count ?? 0
+        if (tailRemaining <= 0) break outer
+        // Fall through — continue collecting tail messages
+      }
+      if (tailRemaining > 0) {
+        tailRemaining--
+        if (tailRemaining === 0) break outer
+      }
     }

     if (!next.more || !next.cursor) break
     before = next.cursor
   }

   result.reverse()
   return result
 })
```

**Edge case, cross-page tail**: Before the `break outer` (now inside the `tailRemaining === 0` condition), `tailRemaining` could be > 0 when the page is exhausted. The outer `while` loop naturally fetches the next page via the `before` cursor, continuing collection. The `if (!next.more || !next.cursor) break` guard handles exhaustion.

**Edge case, no tail**: `tail_count` is `undefined` or `0` → `tailRemaining` stays `0`, `break outer` fires immediately at the boundary (same behavior as today).

#### 1c. `pageCompacted` (lines 1059-1092)

No changes needed. `pageCompacted` calls `filterCompactedEffect` internally, which now correctly includes the original tail messages. The pinning logic at line 1075 (`isCompactionBoundary(active[0]) && active[1]?.info.role === "assistant" && active[1].info.summary`) still works because `active[0]` is still the compaction user message (oldest in the filtered set), and `active[1]` is still the summary assistant (if it exists immediately after). The tail messages are at `active[2..]`.

**Verify**: `pageCompacted` pins `active.slice(0, 2)` (compaction user + summary assistant). The tail from `active.slice(-tailLimit)` now returns the ORIGINAL tail messages (not synthetic copies). This is correct because the `tail.filter(...)` at line 1080 already deduplicates against pinned messages. The `compactedPageCursor(tail[0])` cursor is set on the first tail message, which is now the original (not synthetic) — its `time_created` is older, which is fine for pagination (the `before` cursor uses `(time_created, id)` tuples).

### File 2: `packages/opencode/src/session/compaction.ts`

#### 2a. `processCompaction` — store tail_count (around line 400-410)

After `select()` returns, store the tail count on the compaction part:

```diff
       const selected = yield* select({
         messages: history.filter((_, index) => !hidden.has(index)),
         cfg,
         model,
       })
+      // Store tail count on the compaction part so filterCompactedEffect
+      // can include original tail messages without synthetic copies.
+      if (compactionPart && selected.tail.length > 0) {
+        compactionPart.tail_count = selected.tail.length
+        yield* session.updatePart(compactionPart)
+      }
```

#### 2b. `processCompaction` — remove synthetic tail creation (lines 503-554)

Remove the entire block:

```diff
-      // Create synthetic tail cache messages after the summary assistant.
-      if (selected.tail.length > 0) {
-        let lastSynUserId: MessageID | undefined
-        for (const original of selected.tail) {
-          if (original.info.role === "user") {
-            const synMsg = yield* session.updateMessage({
-              id: MessageID.ascending(),
-              role: "user",
-              sessionID: input.sessionID,
-              time: { created: Date.now() },
-              agent: original.info.agent,
-              model: original.info.model,
-            })
-            ... (entire 65-line block)
-          }
-        }
-      }
```

#### 2c. No changes to `create()` (lines 656-679)

`create()` inserts a user message with a `CompactionPart`. It does not set `tail_count` — that's done during `process()` when `select()` has computed it. Default `undefined` means zero tail (no change from current behavior).

#### 2d. No changes to `select()` (lines 255-301)

`select()` still returns `{ head, tail }`. The `tail` array is now only used inside `processCompaction` to compute `tail_count` for the `CompactionPart`. It is no longer iterated for synthetic creation.

#### 2e. No changes to auto-continue (lines 556-636)

Auto-continue creation is independent of synthetic tail creation. It creates a single user prompt after compaction. The replay messages are also independent.

---

## Caller Impact Analysis

| Caller | File:Line | Impact |
|--------|-----------|--------|
| `prompt.ts` runLoop | `prompt.ts:1135` | No change. `filterCompactedEffect` now returns original tail messages instead of synthetic ones. The message array is used identically. |
| `pageCompacted` | `message-v2.ts:1067` | No change. Internal caller passes through transparently. |
| `filterCompacted` (sync) | `message-v2.ts:1139` | **Must be updated identically.** Same boundary logic (`break` at compaction user) as the Effect version -- needs `tail_count` continuation. The caller passes all messages at once, so cross-page concern doesn't apply, but the boundary break still needs to continue for `tail_count` messages. |

---

## Migration

No DB migration needed:
- Existing synthetic tail messages remain in the DB but are no longer needed. They have `time_created` after the summary assistant and will be included by `filterCompactedEffect` alongside the original tail messages. The deduplication in `pageCompacted:1080` prevents duplicates.
- **Recommendation**: Add a migration in a follow-up to clean up orphaned synthetic tail messages from prior compactions (optional — they're harmless but consume storage).

---

## Test Impact

### Tests to update

| Test file | Impact |
|-----------|--------|
| `test/session/compaction.test.ts` | Tests that verify synthetic tail message count, IDs, token counts (zero), or message ordering after compaction will need updating. The tail messages now have original (non-zero) token counts and original message IDs. |
| `test/session/revert-compact.test.ts` | Tests that verify message count after compaction + revert may change because synthetic tail copies no longer exist as separate DB rows. |

### New test cases needed

1. **tail_count stored on CompactionPart**: Verify `compactionPart.tail_count === selected.tail.length` after `process()`.
2. **filterCompactedEffect includes original tail**: Verify messages returned by `filterCompactedEffect` include the original tail messages (by ID, not synthetic copies).
3. **Cross-page tail**: If tail spans multiple pages (unlikely with 500/page but test the code path), verify collection continues past page boundary.
4. **No tail** (`tail_count = 0` or undefined): Verify `filterCompactedEffect` behavior is unchanged.
5. **Multiple compactions**: Verify that each compaction correctly sets its own `tail_count`.
6. **Errored compaction**: Verify `tail_count` is not stored when `processor.message.error` is set (error checks still happen before we reach the `tail_count` storage).

---

## Tests That Will Fail

### 1. `compaction.test.ts:1097-1153` — "creates synthetic tail messages for retained recent turns"

**Will FAIL** because it asserts on synthetic message counts:
```typescript
// Line 1136: expects summary + 2 synthetic copies
expect(all.length).toBe(msgsBefore.length + 3)  // → should be msgsBefore.length + 1
// Lines 1138-1143: checks tail text from synthetic copies
// → originals already in msgsBefore; assertion semantics change
```

**Fix**: Rewrite to verify `filterCompactedEffect` includes original tail messages by ID, not by counting synthetic copies.

### 2. `compaction.test.ts:1155-1197` — "shrinks retained tail to fit preserve token budget"

Uses `filterCompacted(stream(...))` at line 1189. Will pass only if `filterCompacted` (sync) is updated alongside `filterCompactedEffect`.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Tail messages span multiple DB pages, collection missed | Low (500 msg/page >> tail budget) | Outer `while` loop naturally paginates. `tailRemaining` counter persists across pages. |
| `pageCompacted` cursor breaks with older `time_created` on tail | Low | Cursor is `(time_created DESC, id DESC)`. Older tail time is fine — it just paginates from an earlier point. `compactedPageCursor()` wraps the cursor. |
| `filterCompacted` (sync) not updated in step with `filterCompactedEffect` | Low | Both functions share the same boundary logic. Update both. |
| Existing synthetic tail messages cause duplicates | Low | `pageCompacted:1080` deduplicates against pinned messages. Old synthetic copies and new original tail have different IDs → both appear. Mitigation: add deduplication by `info.id` of the original message. |
| Token counters on original tail messages are non-zero (synthetic copies had zero) | Low | `isOverflowFromContent()` in `overflow.ts:31` was added specifically because synthetic copies had zero tokens. With original messages, token counts are accurate. The function remains valid as a fallback estimation method but its original motivation becomes moot. No functional risk. |

---

## Verification Checklist

- [ ] `CompactionPart.tail_count` schema field added (`message-v2.ts:230`)
- [ ] `filterCompactedEffect` boundary logic updated to continue past boundary for `tail_count` messages (`message-v2.ts:1154-1185`)
- [ ] `filterCompacted` (sync) updated identically (`message-v2.ts:1139-1152`)
- [ ] `filterCompacted` (sync) updated identically with `tail_count` continuation (`message-v2.ts:1139-1152`)
- [ ] Synthetic tail creation block removed (`compaction.ts:503-554`)
- [ ] `tail_count` stored on `CompactionPart` at the correct point in `processCompaction` (after `select()`, before `session.updateMessage(processor.message)`)
- [ ] Test `compaction.test.ts:1097-1153` ("creates synthetic tail messages...") rewritten for new behavior
- [ ] Test `compaction.test.ts:1155-1197` ("shrinks retained tail...") verified still passes
- [ ] New test: `tail_count` correctly stored on CompactionPart
- [ ] New test: `filterCompactedEffect` returns original tail messages by ID
- [ ] New test: no duplicate messages in post-compaction set
- [ ] New test: cross-page tail collection
- [ ] New test: errored compaction doesn't store `tail_count`
- [ ] Run `bun typecheck` from `packages/opencode`
- [ ] Run `bun test packages/opencode/test/session/compaction.test.ts`
- [ ] Run `bun test packages/opencode/test/session/revert-compact.test.ts`
