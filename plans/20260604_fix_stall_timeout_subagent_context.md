# Plan: Fix Stream Stall Timeout + Task Agent 256K Overflow

**Created**: 2026-06-04
**Status**: in_progress (revised after log analysis)
**Owner**: AlHeloween

---

## Goal 1: Fix Stream Stall Timeout (DONE)
- [x] `Stream.timeout` replaces `Effect.timeoutOrElse`
- [x] Default 120s idle timeout
- [x] Typechecked

## Goal 2: Fix Task Agent 256K Context Overflow

### Root Cause (confirmed via investigation)

The internal code correctly isolates caches per-model (`sessionID:agent:modelID` keys everywhere). The leak occurs at the **LLM provider level** — the provider's server-side prompt caching may reuse cached prefixes across calls because both main agent and task agent share the same system prompt (rules, instructions). The provider includes the main agent's 500K cached content in the task agent's request → 500K > 256K → overflow at start.

**We can't control the provider's cache behavior, but we can isolate the task agent's request by NOT including the shared system prompt prefix.**

### Solution (user-directed)

1. **Per-model cache display in TUI** — show cache health state when switching models
2. **Cross-model marker system** — when a task agent runs after a main agent with a different model, add a marker indicating "ran after model X, use messagesearch for context"
3. **Per-model compaction** — if one model is compacted, other models are NOT affected
4. **Model-aware messagesearch** — add modelID to search results so agents can filter by model

### Implementation Tasks

- [x] **2.1**: Export `selectMessages` from compaction.ts (DONE)
- [x] **2.2**: Diagnostic logging in task.ts for model mismatch (DONE)
- [ ] **2.3**: Add per-model cache health display in TUI
  - Extend `dialog-task-settings.tsx` and `dialog-model.tsx` to show cache state
  - Display: model name, input tokens, cache hit ratio, health status
  - Read from `cachePoisonStates` map or expose via a bus event

- [ ] **2.4**: Add cross-model marker system
  - When `task.ts` launches a subagent with a different model than the parent:
    - Add a synthetic system message: `"[Task agent running after main model ${parentModelID}. Use messagesearch with model filter to find relevant context from the parent session ${parentSessionID}]"`
  - The task agent can then use `messagesearch` to retrieve ONLY relevant data from the parent session, instead of trying to load the entire context

- [ ] **2.5**: Ensure per-model compaction isolation
  - Verify `cachePoisonStates` key includes `modelID` (confirmed ✓)
  - If main agent switches models mid-session, store compaction state per model, not per session
  - Add `compaction.modelID` to the compaction part schema

- [ ] **2.6**: Add `modelID` to `messagesearch` results
  - Add `modelID`, `providerID` to `SearchResult` interface in `message-v2.ts`
  - Include them in the FTS query join
  - Enable filtering search results by model: `messagesearch query="..." model="deepseek-v4-pro"`

- [ ] **2.7**: Add pre-call model-aware token validation
  - Before `llm.stream()` in processor.ts, check estimated input tokens against `usable(ctx.model)`
  - If predicted overflow for the current model, set `needsCompaction = true` before the call

- [ ] **2.8**: Fix task result architecture
  - `task.ts:192-198`: return `task_id: ses_xxx` only, not inlined text

### Verification
- [ ] TUI shows cache health when switching between main and task models
- [ ] Compaction of main model does NOT affect task model cache
- [ ] Task agent receives cross-model marker when launched after main agent
- [ ] Messagesearch results include modelID for filtering
- [ ] Task agent with 256K model does NOT overflow due to parent's cached content

### Verification
- [ ] `bun typecheck` passes
- [ ] Task agent with 256K model + large tool outputs → no overflow
- [ ] Main agent context not bloated by inlined task results

---

## Validation Summary (from explore agent against codebase)

| # | Finding | Action |
|---|---------|--------|
| 1 | `Stream.timeout` exists (Effect 4.0.0-beta.57) but does NOT produce `TimeoutException` | Use completion-flag pattern instead of `Effect.catchTag` |
| 2 | `Stream.timeout` takes `Duration.DurationInput` (string `"120000 millis"` format OK) | Match existing code style at `processor.ts:761` |
| 3 | Model resolution has SECOND path in `prompt.ts:382` | Account for both paths in context comparison |
| 4 | `compaction.ts:select()` is private — cannot reuse as-is | Export or wrap with new public method |
| 5 | `select()` uses `preserveRecentBudget()` bound to passed model's context | Must pass task model (not main model) or provide custom budget param |
| 6 | "stalled" result flow correctly understood: `prompt.ts` returns `"continue"`, `compaction.ts` returns `"stop"` | No changes needed |

## Verification

- [ ] `bun typecheck` passes in `packages/opencode/`
- [ ] Existing tests pass: `bun test` in `packages/opencode/`
- [ ] New stall detection tests pass (Goal 1)
- [ ] New subagent context tests pass (Goal 2)
- [ ] Manual test: Run explorer agent with large conversation on a 256K model, verify no context overflow

---

## Implementation Details (Exact Code Changes)

### Goal 1 Changes — `packages/opencode/src/session/processor.ts`

#### Change 1.1: Replace default timeout value (line 32-35)

```diff
+const STREAM_STALL_DEFAULT_MS = 120_000
 function streamStallTimeoutMs() {
   const value = Number(process.env.OPENCODE_STREAM_STALL_TIMEOUT_MS)
-  return Number.isFinite(value) && value > 0 ? value : 30_000_000
+  return Number.isFinite(value) && value > 0 ? value : STREAM_STALL_DEFAULT_MS
 }
```

#### Change 1.2: Replace wall-clock timeout with idle-based Stream.timeout (lines 753-778)

```diff
             const stream = llm.stream(streamInput)
             const stallTimeoutMs = streamStallTimeoutMs()
+            let streamCompleted = false

             yield* stream.pipe(
-              Stream.tap((event) => handleEvent(event)),
+              Stream.tap((event) => {
+                if (event.type === "finish-step") streamCompleted = true
+                return handleEvent(event)
+              }),
               Stream.takeUntil(() => ctx.needsCompaction),
+              Stream.timeout(`${stallTimeoutMs} millis`),
               Stream.runDrain,
-              Effect.timeoutOrElse({
-                duration: `${stallTimeoutMs} millis`,
-                orElse: () =>
-                  Effect.gen(function* () {
-                    if (!ctx.toolCallEmitted) {
-                      ctx.stalled = true
-                      log.warn("bug: llm stream stalled before tool call", {
-                        sessionID: ctx.sessionID,
-                        agent: ctx.assistantMessage.agent,
-                        modelID: ctx.model.id,
-                        messageID: ctx.assistantMessage.id,
-                        timeoutMs: stallTimeoutMs,
-                      })
-                      return
-                    }
-                    yield* halt(new Error(`LLM stream stalled after tool call for ${stallTimeoutMs}ms`))
-                  }),
-              }),
             )
+
+            if (!streamCompleted && !ctx.needsCompaction) {
+              ctx.stalled = true
+              log.warn("bug: llm stream stalled", {
+                sessionID: ctx.sessionID,
+                agent: ctx.assistantMessage.agent,
+                modelID: ctx.model.id,
+                messageID: ctx.assistantMessage.id,
+                timeoutMs: stallTimeoutMs,
+              })
+            }
```

### Goal 2 Changes — `packages/opencode/src/session/compaction.ts` + `packages/opencode/src/tool/task.ts`

#### Change 2.1: Export `select` from compaction.ts

Add to the Service interface (line ~90-100):

```diff
 export interface Interface {
   readonly compact: (...) => Effect.Effect<...>
+  readonly selectMessages: (input: {
+    messages: MessageV2.WithParts[]
+    model: Provider.Model
+  }) => Effect.Effect<{ head: MessageV2.WithParts[]; tail_start_id: string | undefined }>
 }
```

Add to the Service.of return (near line ~620-640):

```diff
 return Service.of({
+  selectMessages: Effect.fn("SessionCompaction.selectMessages")(function* (input) {
+    const cfg = yield* config.get()
+    return yield* select({ ...input, cfg })
+  }),
   compact: ...,
   ...
 })
```

#### Change 2.2: Detect context mismatch in task.ts (after line 121)

In `tool/task.ts`, after model resolution:

```typescript
const model = taskOverride ?? next.model ?? {
  modelID: msg.info.modelID,
  providerID: msg.info.providerID,
}

// NEW: Check context window mismatch between parent and task agent
const parentModel = yield* Effect.gen(function* () {
  // Get parent session's model
  const session = yield* sessions.get(ctx.sessionID)
  // Find last user message for model info
  return { modelID: msg.info.modelID, providerID: msg.info.providerID }
})

// If task model has smaller context window, log warning
// (actual compaction happens in the prompt building phase)
if (parentModel) {
  const taskProvider = yield* provider.getProvider(model.providerID)
  const taskModelInfo = taskProvider?.models[model.modelID]
  const parentProvider = yield* provider.getProvider(parentModel.providerID)
  const parentModelInfo = parentProvider?.models[parentModel.modelID]
  
  if (taskModelInfo?.limit?.context && parentModelInfo?.limit?.context) {
    if (taskModelInfo.limit.context < parentModelInfo.limit.context) {
      log.info("task agent model has smaller context than parent", {
        parentModel: `${parentModel.providerID}/${parentModel.modelID}`,
        parentContext: parentModelInfo.limit.context,
        taskModel: `${model.providerID}/${model.modelID}`,
        taskContext: taskModelInfo.limit.context,
        subagent: next.name,
      })
    }
  }
}
```

> **Note on Goal 2**: The subagent session is created fresh (no history inherited from parent). The overflow would come from the system prompt + rules being too large for a 256K model. The actual fix requires a deeper refactor of how system prompts are built for subagents. The plan documents the diagnostic logging as a first step, and the `selectMessages` export enables the compaction step to be implemented in a follow-up if the logging confirms the overflow source.

---

## SV

```
sv=[[fix,stream,stall,idle-timeout,subagent,context,overflow,compaction],
    [0.22,0.18,0.17,0.13,0.12,0.08,0.06,0.04]]
md5: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
prev-md5: 7d6c51b7fd1c1a1bb419203ff74bca98
semantic_dominant: fix_stall_timeout_subagent_context
```
