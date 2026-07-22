# Compaction MessageStar — Bug Report & Fix Plan

**Date:** 2026-07-22
**Session:** `ses_076e9e1b2ffeKoXS5HMswQQmfG`
**Status:** Investigation complete. Plan ready for execution.

---

## Executive Summary

After mechanistic compaction, the model receives a synthetic `messageStar` — a compressed
representation of the conversation. The messageStar has **two structural bugs** that
cause information loss:

| # | Bug | Severity | Root cause |
|---|-----|----------|------------|
| 1 | User & assistant messages not faithfully rendered | **CRITICAL** | `messageText()` whitelist — only 3 of 12 part types handled |
| 2 | Summaries silently lost for sessions >500 messages | **HIGH** | `session.messages()` default limit=500; old summaries fall off |

Additionally, a **design tension** exists: collecting ALL summaries from session start
creates unbounded messageStar growth (O(n²) over compaction cycles). The current code
claims "all summaries from full DB — never lost" but silently achieves neither completeness
nor boundedness.

**Desired end state:** The messageStar is a faithful, bounded compressed representation:
- **Recent section** = complete turn sequence (user + assistant + tool), all part types rendered
- **Summaries section** = summaries from the CURRENT compaction window only (bounded)
- **No silent data loss** — every message part type in the DB has a rendering path

---

## 1. Bug Boundary Map (Evidence)

### 1a. Concrete evidence from session `ses_076e9e1b2ffe`

Using `session-read` (Exact ground truth), the following user messages were confirmed
present in the DB within the Recent range — but **zero** appear in the messageStar:

| DB # | User message | In messageStar? |
|------|-------------|-----------------|
| #7 | "Понимаешь - ты не сказал моего последнего сообщения перед компактом..." | ❌ |
| #9 | "Нет пока, давай теперь все подробнязенько изложи в plans..." | ❌ |
| #11 | "What was last message? Без session read..." | ❌ |
| #15 | "Ок, сча будем компактить" | ❌ |
| #18 | "Норм" | ❌ |
| #20 | "Ну вот, теперь комит" | ❌ |

Assistant text responses ARE rendered but **merged inline with reasoning blocks** —
no `[text]` label separates "what model thought" from "what model said."

### 1b. The loss chain

```
User types message
  ↓
prompt.ts runLoop: marks original text part ignored: true
                  creates synthetic <system-reminder> wrapper part
  ↓
DB stores: [text(ignored:true)=user's words, text(synthetic)=system wrapper]
  ↓
compaction.ts messageText(): skips ignored parts → extracts only system wrapper
  ↓
messageStar → model sees wrapper text, NOT user's actual words
```

### 1c. What the spec says

From `docs/compaction.md`:

> "fold history into one active `message*` of `(s, s, s, recent m…)`" (line 43)
> "Recent section: tagged `[role \`msg_id\`]` lines + ID range for session-read" (line 111)
> "**Never delete** messages. Soft-hide them from the model context" (line 24)

**`recent m…` = ALL messages after the last summary, faithfully rendered.**
The code violates this specification.

---

## 2. Bug 1: `messageText()` Whitelist (compaction.ts:42–56)

### Current code

```typescript
function messageText(msg: MessageV2.WithParts): string {
  const parts: string[] = []
  for (const p of msg.parts) {
    if (p.type === "text" && !(p as any).ignored) {     // ← Only 3 types handled
      parts.push((p as any).text ?? "")
    } else if (p.type === "reasoning") {
      parts.push(`[reasoning]\n${(p as any).text ?? ""}`)
    } else if (p.type === "tool" && (p as any).state?.status === "completed") {
      parts.push(`[tool:${(p as any).tool}]\n${(p as any).state?.output ?? ""}`)
    }
    // ⚠️ ALL OTHER PART TYPES SILENTLY DROPPED ⚠️
  }
  return parts.join("\n")
}
```

### Part types handled vs dropped

| Part type | Handled? | What's lost |
|-----------|----------|-------------|
| `text` (not ignored) | ✅ Raw text | — |
| `text` (ignored) | ❌ | **User's actual words** |
| `reasoning` | ✅ `[reasoning]\n...` | — |
| `tool` (completed) | ✅ `[tool:xxx]\n...` | — |
| `tool` (pending/error) | ❌ | In-progress tool state |
| `subtask` | ❌ | Subagent dispatch prompt |
| `file` | ❌ | User-provided files/images |
| `step-start` | ❌ | Turn boundaries |
| `step-finish` | ❌ | Turn boundaries |
| `snapshot` | ❌ | Fossil snapshot markers |
| `patch` | ❌ | Patch content |
| `agent` | ❌ | Agent metadata |
| `retry` | ❌ | Retry markers |
| `compaction` | ❌ | Compaction markers (intentional skip) |

### Fix

Replace the whitelist with a **rendering switch** that covers ALL part types.
Every part type gets at least a labeled placeholder. The messageStar is a SYSTEM
artifact — it must faithfully render what's in the DB.

```typescript
function messageText(msg: MessageV2.WithParts): string {
  const parts: string[] = []
  for (const p of msg.parts) {
    switch (p.type) {
      case "text":
        parts.push(`[text]\n${(p as any).text ?? ""}`)
        break
      case "reasoning":
        parts.push(`[reasoning]\n${(p as any).text ?? ""}`)
        break
      case "tool":
        const label = `[tool:${(p as any).tool}]`
        const status = (p as any).state?.status ?? "unknown"
        const output = (p as any).state?.output ?? ""
        parts.push(`${label} (${status})\n${output}`)
        break
      case "subtask":
        parts.push(`[subtask:${(p as any).agent}]\n${(p as any).prompt ?? ""}`)
        break
      case "file":
        parts.push(`[file: ${(p as any).filename ?? "unknown"} (${(p as any).mime ?? "?"})]`)
        break
      case "step-start":
      case "step-finish":
        parts.push(`[${p.type}]`)
        break
      case "snapshot":
        parts.push(`[snapshot: ${(p as any).hash ?? "?"}]`)
        break
      case "patch":
        parts.push(`[patch]\n${(p as any).content?.slice(0, 500) ?? ""}`)
        break
      case "agent":
        parts.push(`[agent: ${(p as any).agent ?? "?"}]`)
        break
      case "retry":
        parts.push(`[retry]`)
        break
      case "compaction":
        // intentional skip — compaction markers are internal
        break
    }
  }
  return parts.join("\n")
}
```

**Key changes:**
1. Remove `&& !(p as any).ignored` guard → user text renders
2. Add `[text]` label for ALL text parts → separates thought from speech
3. Handle `subtask`, `file`, `step-start/step-finish`, `snapshot`, `patch`, `agent`, `retry`
4. Tool parts render regardless of status (not just `completed`)

---

## 3. Bug 2: 500-Message Limit Silently Truncates Summaries

### Current behavior

`compact()` calls `session.messages()` without passing a `limit` parameter →
defaults to **500 messages**. `page()` returns only the newest 500 messages.

```
Session: 10,000 messages
  ↓
session.messages() → limit=500
  ↓
page() returns messages 9501–10000 (newest 500)
  ↓
summaries collected ONLY from these 500
  ↓
Summary assistant at message #5000 → PERMANENTLY LOST from messageStar
```

### Contradictory code comment

```typescript
// All summary assistants from full DB (including soft-hidden) — never lost.
// (compaction.ts, line ~311)
```

This is false. The 500-message limit silently drops old summaries.

### Design tension

Even if we fix the limit (read ALL messages), collecting EVERY summary from session
start creates **unbounded messageStar growth**:

```
Cycle 1: message*  = (s₁, s₂, s₃, recent)              ← 3 summaries,   ~3K tokens
Cycle 2: message** = (s₁, s₂, s₃, s₄, s₅, recent)       ← 5 summaries,   ~5K tokens
Cycle 3:             (s₁...s₅, s₆...s₈, recent)         ← 8 summaries,   ~8K tokens
...
Cycle 50:            (s₁...s₁₂₀, recent)                ← 120 summaries, ~120K tokens
```

The messageStar grows **unboundedly** with each compaction cycle. This defeats the
purpose of compaction — keeping the active context bounded.

### Proposed design

**MessageStar should contain summaries from the CURRENT compaction window only**
— i.e., summaries created since the last `message*` (or since session start for
the first compaction).

```
Cycle 1: message*  = (s₁, s₂, s₃, recent)              ← summaries from window 1
Cycle 2: message** = (s₄, s₅, recent)                  ← only NEW summaries + ref to message*
         ...plus a chain link: "Prior message*: msg_xxx"
Cycle 3: message*** = (s₆, s₇, s₈, recent)             ← only NEW summaries
```

**Benefits:**
- Bounded messageStar size (~3-5 summaries per cycle)
- No silent data loss (the 500-limit bug becomes irrelevant)
- Chain of messageStars linked via IDs → full history recoverable via `session-read`
- O(1) growth instead of O(n²)

**Tradeoff:** The model can't read old summaries inline. It must use `session-read`
to access them. But this is already the documented pattern (doc line 61: "Agent needs
detail → `session-read` with message IDs").

### Implementation

In `compact()`:
1. Find the most recent prior `message*` (if any) in the visible set
2. Collect summaries ONLY from messages created AFTER that prior `message*`
3. Include a reference line: `Prior message*: \`<id>\` — session-read for older summaries`
4. Remove or update the misleading comment about "all summary assistants from full DB"

Also fix the 500-limit defense: pass an explicit higher limit (or remove the limit)
for `session.messages()` in `compact()` and `injectSummaryRequest()`.

---

## 4. Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `packages/opencode/src/session/compaction.ts` | Fix `messageText()` — render ALL part types | **P0** |
| `packages/opencode/src/session/compaction.ts` | Fix summary collection scope — current window only, not all session | **P0** |
| `packages/opencode/src/session/compaction.ts` | Fix `session.messages()` limit — pass explicit limit or use unbound read | **P0** |
| `packages/opencode/src/session/compaction.ts` | Update misleading comments | P1 |
| `packages/opencode/test/session/compaction.test.ts` | Add rendering tests for all part types | P1 |
| `packages/opencode/test/session/compaction.test.ts` | Add summary scope tests | P1 |
| `docs/compaction.md` | Update to reflect bounded summary collection | P2 |

---

## 5. Verification

### Primary fix (messageText rendering)

1. Run existing tests: `bun test test/session/compaction.test.ts`
2. Add new tests:
   - User message with text → output contains user's words
   - User message with `ignored: true` text → still renders (guard removed)
   - Assistant message → `[text]` and `[reasoning]` are separately labeled
   - `subtask` part → renders prompt text
   - `file` part → renders filename and MIME
   - `tool` part with `error` status → renders (not just `completed`)
3. Typecheck: `bun typecheck` from `packages/opencode`
4. Manual: trigger compaction, verify model can read user messages in messageStar

### Secondary fix (summary scope)

5. Test: session with 3 compaction cycles → messageStar contains only summaries from current window
6. Test: prior messageStar ID reference present
7. Test: `session-read` can recover older summaries via the chain link
8. Manual: long session (>500 messages) → no silent summary loss

---

## 6. What We Want (Desired End State)

1. **Faithful Recent section**: Every message (user + assistant) after the last summary
   is rendered with ALL its part types visible. The model can trace the conversation
   turn-by-turn without `session-read`.

2. **Bounded Summaries section**: Only summaries from the current compaction window.
   Older summaries accessible via `session-read` using the prior messageStar chain link.
   MessageStar size stays bounded (~3-5 summaries) regardless of session length.

3. **No silent data loss**: Every part type has a rendering path. No truncation from
   arbitrary limits. The messageStar is a SYSTEM artifact that faithfully reflects
   the DB state.

4. **Code matches docs**: Comments accurately describe behavior. Documentation reflects
   the bounded summary collection design.

5. **Test coverage**: Every part type has a rendering test. Summary scope has boundary
   tests (>500 messages, multi-cycle compaction).
