# Fix: insertReminders Idempotency — Stop 1.8M Token Burns

**Date**: 2026-06-21
**Status**: planning

---

## Root Cause

`prompt.ts:229-276` — `insertReminders` pushes a NEW synthetic text part to the last user message on **every turn**, every loop iteration. The new part is persisted to DB via `sessions.updatePart()`, so it accumulates forever.

`cache-control.ts:140` — text part fingerprint includes `part.id` and `md5(text)`. Each new part has a new `PartID.ascending()` → message fingerprint changes every turn → `auditCache` reports "text content changed" at that message index → KV cache broken from divergence point forward → 95-99% of context reprocessed.

## Token Impact

| Factor | Value |
|--------|-------|
| Session turns (observed) | 57 |
| System + context per turn | ~32k tokens |
| Cache break rate | **100%** (every turn) |
| Tokens burned | 57 × 32k = **~1.8M** |

## Fix: Make `insertReminders` Idempotent

**File**: `packages/opencode/src/session/prompt.ts:229-276`

**Abstract**: Before pushing a synthetic part, check if an identical synthetic part already exists on the user message. If a part with the same text content (or same semantic purpose) already exists, skip the push.

**Implementation**:

```typescript
const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
  messages: MessageV2.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  // Helper: check if a synthetic text part with given content already exists
  const hasSyntheticPart = (text: string) =>
    userMessage.parts.some(
      (p): p is MessageV2.TextPart & { synthetic: true } =>
        p.type === "text" && (p as any).synthetic === true && p.text === text,
    )

  if (!Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE) {
    if (input.agent.name === "plan") {
      if (!hasSyntheticPart(PROMPT_PLAN)) {
        userMessage.parts.push({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: PROMPT_PLAN,
          synthetic: true,
        })
      }
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      if (!hasSyntheticPart(BUILD_SWITCH)) {
        userMessage.parts.push({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: BUILD_SWITCH,
          synthetic: true,
        })
      }
    }
    return input.messages
  }

  // ... rest unchanged, apply same idempotency guard
})
```

**Key change**: `hasSyntheticPart(text)` checks if a synthetic text part with identical text already exists on the user message before pushing a new one.

## Test Cases

- [ ] Plan mode: first turn pushes PROMPT_PLAN → second turn does NOT push again → parts count stable
- [ ] Build mode after plan: first turn pushes BUILD_SWITCH → subsequent turns do NOT push again
- [ ] Plan mode with existing plan file: part pushed once, subsequent turns don't re-push
- [ ] KV cache audit shows no cache breaks on consecutive build-agent turns
- [ ] Existing sessions with accumulated synthetic parts: old parts remain, no new ones added

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Synthetic parts | +1 every turn (unbounded growth) | +1 only on first applicable turn |
| Message fingerprint | Changes every turn | Stable after first application |
| KV cache hit ratio | 0% (broken every turn) | 95%+ (broken only on real content changes) |
| Tokens per turn | ~32k | ~2k incremental |
| 57-turn session cost | ~1.8M tokens | ~220k tokens |
