# Compaction "Written Then Gone" — Investigation & Fix Plan

**Date:** 2026-06-11  
**Status:** Completed  
**Priority:** High

---

## Summary

Compaction creates messages that appear to be written but are later missing — the
compaction boundary is not detected, causing all historical messages to be loaded
again, defeating the purpose of compaction.

## Implementation Status — 2026-06-11

Completed:
- `processCompaction` now stops before synthetic tail / auto-continue messages when the compaction summary is errored.
- `filterCompacted` and `filterCompactedEffect` now accept completed errored summaries as valid compaction boundaries.
- Limited message retrieval now has a compacted active-window pager that preserves the compaction boundary and summary in the first page.
- Limited HTTP API and legacy session routes now use compacted paging.
- The v2 `session.next.compaction.ended` event now includes the persisted summary text instead of an empty string.
- Added regression coverage for limited compacted paging.
- `SessionProcessor.halt()` sets `finish = "error"`, records `time.completed`, and persists errored assistant state immediately.
- Added processor oracle coverage for persisted non-overflow API errors and interrupted messages.
- Message and part update sync events now carry explicit project context, so interrupted finalizers can persist updates without relying on ambient `Instance` context.

Pending:
- None for this plan.

---

## Root Cause (Primary)

When an error occurs during compaction's LLM streaming, the `halt()` function in
`processor.ts:692-706` sets `ctx.assistantMessage.error` but does **NOT** set
`ctx.assistantMessage.finish`. The `cleanup()` finalizer runs afterwards at
line 681-689 and calls `session.updateMessage()`, but only sets `time.completed`
— `finish` remains `undefined`.

Back in `processCompaction` (compaction.ts), the function checks
`processor.message.error` at line 622 and returns `"stop"`. The loop is exited.

On the next session load, `filterCompactedEffect` (message-v2.ts:1120) checks:
```
msg.info.summary && msg.info.finish && !msg.info.error
```

Since `error` is truthy (set by `halt`), the compaction boundary is **NOT**
detected. All historical messages load, making compaction appear to have been
"lost" — the summary message exists in the DB but is unusable.

**Files involved:**
- `packages/opencode/src/session/processor.ts:692-706` — `halt()` lacks `finish` set + `updateMessage` call
- `packages/opencode/src/session/message-v2.ts:1120-1122` — fragile boundary check

---

## Secondary Issues

### Issue 2: Orphaned synthetic messages after late error
`processCompaction` at lines 488-538 creates synthetic tail messages and at
lines 540-619 creates auto-continue messages BEFORE checking `processor.message.error`
at line 622. If error exists, these messages are orphaned in the DB.

**File:** `packages/opencode/src/session/compaction.ts:488-622`

### Issue 3: `halt()` does not call `updateMessage` at all
When `halt()` is called for non-overflow errors, it sets `error` on the
assistant message object but never calls `session.updateMessage()`. The caller
(`cleanup()` or `onInterrupt`) may call it later, but the error state is not
persisted via the standard update path. This means the bus event for the error
is published (line 701) but the message's persisted state may be stale.

**File:** `packages/opencode/src/session/processor.ts:692-706`

---

## Fix Plan

### Fix 1: Ensure `halt()` always sets `finish` and calls `updateMessage` during compaction

**Target:** `packages/opencode/src/session/processor.ts:692-706`

The `halt()` function should always set `ctx.assistantMessage.finish = "error"`
when setting an error, and should call `yield* session.updateMessage(ctx.assistantMessage)`
to persist the error state immediately:

```diff
 const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
     slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
     const error = parse(e)
     if (MessageV2.ContextOverflowError.isInstance(error)) {
         ctx.needsCompaction = true
         yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
         return
     }
     ctx.assistantMessage.error = error
+    ctx.assistantMessage.finish = "error"
+    ctx.assistantMessage.time.completed = Date.now()
+    yield* session.updateMessage(ctx.assistantMessage)
     yield* bus.publish(Session.Event.Error, {
         sessionID: ctx.assistantMessage.sessionID,
         error: ctx.assistantMessage.error,
     })
     yield* status.set(ctx.sessionID, { type: "idle" })
 })
```

### Fix 2: Move error check BEFORE creating synthetic messages

**Target:** `packages/opencode/src/session/compaction.ts:473-622`

Reorder `processCompaction` so the error check at line 473 (`result === "compact"`)
and line 622 (`processor.message.error`) happen BEFORE creating tail/auto-continue
messages:

```diff
+ // Check for errors early before creating any synthetic messages
+ if (result === "compact") {
+     processor.message.error = new MessageV2.ContextOverflowError({...}).toObject()
+     processor.message.finish = "error"
+     yield* session.updateMessage(processor.message)
+     return "stop"
+ }
+ if (processor.message.error) {
+     yield* session.updateMessage(processor.message)
+     return "stop"
+ }
 
  // Persist the completed summary assistant
  yield* session.updateMessage(processor.message)
  
  // THEN create synthetic tail / auto-continue messages
  ...
```

### Fix 3: Make `filterCompactedEffect` boundary detection more robust

**Target:** `packages/opencode/src/session/message-v2.ts:1117-1123`

Consider recognizing compaction boundaries even when `error` is set but
`finish === "error"` — an errored compaction should still serve as a boundary:

```diff
- if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
+ if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish)
```

This changes the boundary condition to accept ANY summary assistant with a
`finish` value (including "error"), because the compaction user message still
exists and serves as the boundary. The error state on the summary can be
handled separately by the UI.

---

## Verification

1. Run existing compaction tests:
   ```
   bun test packages/opencode/test/session/compaction.test.ts
   bun test packages/opencode/test/session/revert-compact.test.ts
   ```
2. Run typecheck:
   ```
   bun typecheck
   ```
3. Manual: trigger compaction to overflow and verify messages are properly filtered
   on subsequent session loads
4. Manual: interrupt compaction mid-stream and verify the error boundary is detected

---

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `packages/opencode/src/session/processor.ts` | 692-706 | `halt()`: set `finish = "error"`, call `updateMessage` |
| `packages/opencode/src/session/compaction.ts` | 473-622 | Move error checks before synthetic message creation |
| `packages/opencode/src/session/message-v2.ts` | 1120 | Accept errored summaries as valid boundaries |
| `packages/opencode/src/session/processor.ts` | 681-689 | Ensure `cleanup()` doesn't clobber error set by `halt()` |
