# TUI Performance Fix Plan

Date: 2026-06-09  
Status: Plan (validated, not yet implemented)

## Problems

### A. Render-loop unresponsiveness (continuous lag)
Tool components write SolidJS signals during `renderBefore`, causing infinite re-render cascades. 14 InlineTool call sites × signal write per render = main thread saturated.

### B. Message submission delay (5-10s gap)
The submit pipeline loads and converts ALL session messages (+ AI SDK processing) before the first token appears. O(n) in session size, synchronous.

---

## Problem A: Render-Loop Unresponsiveness

### Root Causes

#### A1. CRITICAL: `renderBefore` writes signals during render phase
**`src/cli/cmd/tui/routes/session/index.tsx:1753-1774`**

`InlineTool` (14 call sites — bash, read, glob, grep, webfetch, universalsearch, skill, task, etc.) calls `setMargin()` inside `renderBefore`, a callback that runs on every SolidJS render cycle. Since `setMargin` is a signal setter, SolidJS detects the write → schedules re-render → `renderBefore` fires again → cascade.

Additionally, `parent.getChildren()` + `children.indexOf(el)` are O(n) per tool per render.

#### A2. MEDIUM: `createMemo` inside `<For>` loop (unnecessary overhead)
**`src/cli/cmd/tui/routes/session/index.tsx:1431-1445`**

`createMemo(() => PART_MAPPING[part.type])` per part per assistant message. `PART_MAPPING` is a static 3-entry constant — the lookup is pure O(1) and never changes. The memo wrapper adds tracking overhead per part without any caching benefit.

#### A3. LOW-MEDIUM: Event batch size unbounded
**`src/cli/cmd/tui/context/sdk.tsx:47-58`**

During streaming, hundreds of `message.part.delta` events arrive within a 16ms window. The flush dumps all queued events into a single `batch()` → all downstream reactive updates fire simultaneously → frame drop.

### Fixes

#### A1: Remove signal-writes from `renderBefore`

Replace runtime sibling-height measurement with a **type-based** margin passed from the parent `For` loop.

**Approach:**
1. In `AssistantMessage.For`, compute margin for each part based on the **previous visible part's type** (not raw array index — must skip parts hidden by `<Show>`).
2. Pass margin via a new `toolMargin` prop on `InlineTool`.
3. Remove `margin` signal and `renderBefore` from `InlineTool`.

**Margin rules (replicating original behavior):**
- `index === 0` (first visible part) → margin = 0
- Previous visible part type is `text` or `reasoning` → margin = 1
- Previous visible part's current tool state is `pending` (meaning it will render as block) → margin = 1
- Otherwise → margin = 0

**Edge cases handled:**
- `<Show>` filtering: compute over filtered visible parts, not raw `props.parts`
- `reasoning` parts: treated same as `text` (both render with `id="text-..."`)
- Dynamic tool status (pending→completed): margin computed from the CURRENT part state, which SolidJS tracks reactively via `props.part.state.status`

#### A2: Remove `createMemo` from `<For>` loop

Replace with direct constant lookup:
```tsx
<For each={props.parts}>
  {(part, index) => {
    const Component = PART_MAPPING[part.type as keyof typeof PART_MAPPING]
    return (
      <Show when={Component}>
        <Dynamic component={Component} part={part as any} message={props.message} />
      </Show>
    )
  }}
</For>
```

#### A3: Cap event batch size

**`sdk.tsx:47-58`** — Limit drain to 200 events per flush, schedule remainder:
```tsx
const MAX_BATCH = 200
const flush = () => {
  if (queue.length === 0) return
  const events = queue.splice(0, MAX_BATCH)
  if (queue.length > 0) {
    timer = setTimeout(flush, 0)  // schedule remainder
  } else {
    timer = undefined
  }
  last = Date.now()
  batch(() => {
    for (const event of events) emitter.emit("event", event)
  })
}
```

---

## Problem B: Message Submission Delay (5-10s)

### Root Causes

#### B1. CRITICAL: `filterCompactedEffect` loads ALL messages from DB
**`message-v2.ts:1088`** — Calls `stream(sessionID)` which paginates the ENTIRE session (all messages + all parts) from SQLite. For a session with 2000 messages: ~8 DB round-trips, each loading full JSON-blobbed row data.

**Cost**: 500ms–3s depending on session size and disk I/O.

**Why it blocks**: Runs synchronously at the start of `runLoop()` before anything else.

#### B2. CRITICAL: `toModelMessagesEffect` converts ALL messages through AI SDK
**`message-v2.ts:736-790`** — Iterates every message + every part, processes tool outputs (media checks, truncation, attachment handling), then calls AI SDK's `convertToModelMessages()` which is a heavyweight normalization function.

**Cost**: 200ms–2s depending on message count. Tool parts with attachments are expensive.

**Why it blocks**: Runs in `Effect.all()` in `prompt.ts:1311-1319`, sequential with system prompt construction.

#### B3. MEDIUM: Compaction `estimate()` calls are sequential
**`compaction.ts:260-267`** — When overflow is detected, `select()` calls `estimate()` for each recent turn with `{ concurrency: 1 }`. Each estimate calls `toModelMessagesEffect()` + `Token.estimate(JSON.stringify(...))` — re-converting message subsets.

**Cost**: O(turns) × ~200ms per turn. For 10+ turns: 2+ seconds.

**Why it blocks**: Only triggered on overflow, but when it does, it's fully sequential.

### Fixes

#### B1: Lazy-load only the tail of the session

Instead of loading all messages via `stream(sessionID)`, load only the most recent N messages (or the tail needed for the next turn). The `filterCompacted` boundary already marks where compaction happened — only messages after the latest compaction boundary need to be loaded for display/processing.

**Approach:** Create `streamTail(sessionID, limit)` that iterates newest-first and stops at the compaction boundary. This matches the existing `filterCompacted` logic but does it at the DB level.

#### B2: Cache `toModelMessagesEffect` result per turn

Store converted model messages in memory (not DB) for the current session processing cycle. The same messages are converted multiple times (once for `toModelMessagesEffect`, potentially again in `compaction.estimate`). A memoized cache keyed on `messageID → partID → type` would eliminate redundant conversion.

**Approach:** Add an LRU cache to `MessageV2.toModelMessages` that caches the converted `UIMessage[]` for the most recent message batch. Invalidate on part updates.

#### B3: Parallelize compaction `estimate()` calls

Change `{ concurrency: 1 }` to `{ concurrency: "unbounded" }` at `compaction.ts:267`. Each estimate is independent — they estimate different message slices.

---

## Implementation Order

1. **A1**: Remove `renderBefore` signal writes (highest UX impact — continuous lag)
2. **A2**: Remove `createMemo` in For loop (simple, safe)
3. **B1**: Lazy-load tail in `filterCompactedEffect` (highest submission delay impact)
4. **B3**: Parallelize compaction estimates (simple one-line fix)
5. **A3**: Cap event batch size (timer bug fix + throttle)
6. **B2**: Cache model message conversion (more complex, lower priority)

## Files Modified
1. `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — A1 (InlineTool margin), A2 (For loop memo)
2. `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` — A3 (batch cap)
3. `packages/opencode/src/session/message-v2.ts` — B1 (lazy tail load)
4. `packages/opencode/src/session/compaction.ts` — B3 (parallel estimates)

## Verification
- Typecheck: `bun typecheck` from `packages/opencode`
- A1/A2: Open session with 30+ tool calls, verify smooth scrolling and no input lag
- B1/B3: Send message in large session (~1000 messages), measure time from Enter to first token
- Smoke tests: `bun test test/session/compaction.test.ts test/session/messages-pagination.test.ts`

## Known Risks
- A1: Index-based margin may produce slightly different spacing than height-based margin for edge cases (e.g., tool output with embedded newlines). Visual review required.
- B1: If tail loading misses messages that need to be sent to the model (e.g., because they're after the compaction boundary but still contextually relevant), the LLM response quality could degrade. Must verify with `filterCompacted` boundary logic.
