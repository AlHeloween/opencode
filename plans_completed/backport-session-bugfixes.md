# Backport: Upstream session bugfixes

Backport 5 standalone bugfixes from upstream `dev` into our `Local_Development` branch.

## 1. Finalize interrupted assistant messages

**Commit:** `e76cf967e` (fix(session): finalize interrupted assistant messages #27254)

**Problem:** When a session is cancelled/interrupted mid-stream, the assistant message is left dangling — no `time.completed` set, no error recorded. This corrupts the message history.

**Fix:** Add `finalizeInterruptedAssistant` function and attach it via `Effect.onInterrupt()` to both the processor handle creation and the loop outcome processing.

**Files to change:**
- `packages/opencode/src/session/prompt.ts` — add `finalizeInterruptedAssistant` and wire into loop

**Key code:**
```ts
const finalizeInterruptedAssistant = Effect.gen(function* () {
  if (msg.time.completed) return
  msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
    providerID: msg.providerID,
    aborted: true,
  })
  msg.time.completed = Date.now()
  yield* sessions.updateMessage(msg)
})
```
Attach to processor handle:
```ts
const handle = yield* processor.create({...})
  .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))
```
Attach to loop outcome:
```ts
}).pipe(
  Effect.ensuring(instruction.clear(handle.message.id)),
  Effect.onInterrupt(() => finalizeInterruptedAssistant),
)
```

## 2. Compaction tail ordering fix

**Commit:** `811954880` (fix(compaction): order compaction summary before retained tail #25851) and `ca28dd02e` (fix(compaction): restore tail turns after summarization #27145)

**Problem:** After compaction, `filterCompacted()` produces messages in wrong order: tail → summary when it should be summary → tail. Also, compaction lost tail turns entirely in some edge cases.

**Fix:** Add reordering logic at the end of `filterCompacted()` in `message-v2.ts`. Find compaction message, its summary response, and the tail start, then reorder as `[summary, tail, ...rest]`.

**Files to change:**
- `packages/opencode/src/session/message-v2.ts` — add reordering in `filterCompacted()`
- `packages/opencode/src/session/compaction.ts` — use `structuredClone` instead of manual spread

**Key code** (message-v2.ts, in `filterCompacted`, after the existing logic):
```ts
const compactionIndex = result.findLastIndex(
  (msg) =>
    msg.info.role === "user" &&
    msg.parts.some((item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined),
)
const compaction = result[compactionIndex]
const part = compaction?.parts.find(
  (item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
)
const summaryIndex = compaction
  ? result.findIndex(
      (msg, index) =>
        index > compactionIndex &&
        msg.info.role === "assistant" &&
        msg.info.summary &&
        msg.info.parentID === compaction.info.id,
    )
  : -1
const tailIndex = part?.tail_start_id ? result.findIndex((msg) => msg.info.id === part.tail_start_id) : -1
if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
  return [
    ...result.slice(compactionIndex, summaryIndex + 1),
    ...result.slice(tailIndex, compactionIndex),
    ...result.slice(summaryIndex + 1),
  ]
}
return result
```

**Key code** (compaction.ts, in layer/prepare):
```ts
// Replace:
const msgs = selected.head.map((m) => ({ info: { ...m.info }, parts: [...m.parts] }))
// With:
const msgs = structuredClone(selected.head)
```

## 3. Cancel subtask child sessions

**Commit:** `75d141b57` (fix(session): cancel subtask child sessions #25798)

**Problem:** When a parent session is aborted, child subtask sessions keep running. The abort signal listener wasn't properly wired to cancel the child.

**Fix:** Use `EffectBridge` to fork the cancel operation, catch interrupts via `Exit.hasInterrupts()`, and ensure cleanup with `Effect.ensuring()`.

**Files to change:**
- `packages/opencode/src/tool/task.ts` — refactor abort handling

**Key changes:**
```ts
// Import
import { EffectBridge } from "@/effect/bridge"
import { Effect, Exit, Schema } from "effect"

// In TaskTool.execute:
const runCancel = yield* EffectBridge.make()
const cancel = ops.cancel(nextSession.id)

function onAbort() {
  runCancel.fork(cancel)
}

// Replace cancel with onAbort in event listener
ctx.abort.addEventListener("abort", onAbort)

// Release handler:
(_, exit) =>
  Effect.gen(function* () {
    if (Exit.hasInterrupts(exit)) yield* cancel
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        ctx.abort.removeEventListener("abort", onAbort)
      }),
    ),
  ),
```

Also update `TaskPromptOps` interface — `cancel` returns `Effect.Effect<void>` instead of `void`:
```ts
export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}
```

## 4. Use Database.use() directly

**Commit:** Multiple (remove `db()` wrapper, use `Database.use()` directly)

**Problem:** A `db()` wrapper function routed queries through `projectDb()` (from `@/storage/project-db`), adding unnecessary indirection.

**Fix:** Replace `db((db) => ...)` calls with `Database.use((db) => ...)` directly in `message-v2.ts`.

**Files to change:**
- `packages/opencode/src/session/message-v2.ts` — replace all `db((db) => ...)` with `Database.use((db) => ...)`
- Remove the `db` function definition and `projectDb` import

**Locations:** `hydrate()` line ~696, `page()` line ~994, `parts()` line ~1041, `get()` line ~1056

## 5. structuredClone in compaction

**Commit:** `ca28dd02e` (fix(compaction): restore tail turns after summarization #27145) — part of

**Problem:** Manual spread `{ info: { ...m.info }, parts: [...m.parts] }` is verbose and error-prone.

**Fix:** Replace with `structuredClone(selected.head)`.

**Files to change:**
- `packages/opencode/src/session/compaction.ts` — one line change

## Not backporting

The following upstream changes are part of larger architectural migrations and not standalone fixes:
- **NonNegativeInt schema migration** — requires migrating all Zod statics to Effect Schema across many files
- **SyncEvent integration** — requires `@/v2/session-event`, `@/sync` infrastructure we don't have
- **referenceTextPart / referencePromptMetadata** — depends on `Reference` service we may not have
- **Tool.execute OpenTelemetry span** — nice-to-have, not a bugfix
- **Prevent empty text parts for signed reasoning** — edge case for Anthropic, not critical
- **Tolerate legacy numeric data** — our data is fresh, no legacy to tolerate
- **currentModel from session table** — our `SessionTable` lacks `model`/`agent` columns; requires schema migration first
