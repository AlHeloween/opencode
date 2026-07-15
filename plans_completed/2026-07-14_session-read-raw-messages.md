# Plan: Session-Read — Read Raw Messages, Not Compaction Summaries

## Problem

After compaction, `session-read` mixes compaction summary messages with original
messages. When reading from offset=1, the assistant sees its own current-turn
reasoning at the earliest indices because the flat message stream interleaves
compaction artifacts with live messages in chronological order. There is no way
to skip compacted summaries and read only the *original* conversation.

This forces the user to copy-paste the entire conversation back — messages
exist in the DB unharmed but are unfindable through the tool.

## Root Cause

`session-read.ts` calls `MessageV2.stream()` which returns ALL messages
including:
- Compaction user messages (with `type: "compaction"` parts)
- Compaction assistant messages (with `summary: true`)
- Original pre-compaction messages (still intact)
- Current-turn messages

The tool has no filtering — it streams everything and slices by offset/limit.
The flat index `#N` is computed from the offset, so navigation to
pre-compaction messages requires scanning thousands of messages blindly.

## Solution

Add an optional `raw` boolean parameter to the session-read tool. When `true`,
exclude compaction summary messages (those with parts of type `"compaction"`
on user role or `summary: true` on assistant role). This leaves only the
original conversation messages.

### Parameter schema addition (line 15 area):

```ts
raw: Schema.optional(Schema.Boolean).annotate({
  description: "When true, skip compaction summary messages and show only original conversation. Default: false.",
}),
```

### Filtering logic (insert after line 43):

```ts
for (const msg of MessageV2.stream(sid)) {
  if (params.raw) {
    // Skip compaction user messages (type: "compaction" part)
    if (msg.info.role === "user" && msg.parts.some(p => p.type === "compaction")) continue
    // Skip compaction assistant messages (summary: true)
    if (msg.info.role === "assistant" && (msg.info as any).summary) continue
  }
  messages.push(msg)
}
```

### Files changed

| File | Change |
|------|--------|
| `packages/opencode/src/tool/session-read.ts` | Add `raw` parameter + filtering logic (~8 lines) |
| `packages/opencode/src/tool/session-read.txt` | Document the `raw` parameter in description |

## Verification

- [x] 1. Build: `bun run packages/opencode/script/build.ts --single`
- [x] 2. Start a session, run multiple turns, trigger compaction
- [x] 3. Call `session-read(sessionId, { raw: true, limit: 20 })`
- [x] 4. Verify output contains only original user/assistant messages — no `[summary]` entries
- [x] 5. Call `session-read(sessionId, { raw: false })` — verify all messages including summaries appear
- [x] 6. Call `session-read(sessionId)` (no `raw` param) — verify default behavior unchanged (all messages)

## Completion

- [x] `session-read.ts`: Added `raw` parameter + filtering logic (lines 18-21, 46-50)
- [x] `session-read.txt`: Documented `raw` parameter (line 27)
- [x] `tsgo --noEmit`: Zero errors
