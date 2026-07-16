# Plan: Incremental Summary + Algorithmic Compaction

**Date:** 2026-07-16
**Status:** ✅ Implemented
**Scope:** `packages/opencode/src/session/compaction.ts`, `overflow.ts`, `prompt.ts`, `processor.ts`, `agent.ts`, `llm.ts`

## Architecture

### Problem

Old approach: collect gigantic content, trigger a separate "compaction agent" call, model produces a monolithic summary. This was:
- Wasteful: full kernel prefix loaded for a simple summary task
- Unreliable: model ignored `no_tools`/`no_reasoning` constraints and emitted tool calls
- Cache-breaking: separate agent = separate KV cache

### Solution

Algorithmic compaction with three layers:

```
messages → {m,m,m,m,m,m,s,m,m,m,m,s,m,m,m,m} → compact → {s,s,m,m,m,m} → checkpoint
                ↑              ↑
           32K tokens     another 32K
        injectSummaryRequest()
        model produces summary (s)
        assistant.summary = true
```

#### Layer 1: Incremental Summaries (every 32K output tokens)

`prompt.ts` `runLoop` tracks `outputTokensSinceLastSummary`. After each successful LLM turn, tokens accumulate. At 32K threshold:
- `compaction.injectSummaryRequest()` creates a user message with exact message ID range: "Summarize from `msg_X` to `msg_Y`"
- Model responds normally (no separate agent)
- Assistant message marked `summary: true`
- Counter resets to 0

#### Layer 2: Algorithmic Compaction (on overflow)

When `isOverflowFromContent()` or `isOverflow()` detects overflow:
- `compaction.compact()` finds the most recent `summary: true` boundary
- Removes all messages older than the boundary from DB (`session.removeMessage`)
- Injects a compacted-context user message with precise DB targeting:
  - Summary assistant ID
  - Active context message IDs (tail)
  - Session ID for `session-read`
- No separate compaction agent — just message injection and DB pruning
- `filterCompactedEffect` takes fast path (no `CompactionPart` → load all)

#### Layer 3: Continuous Memory via DB Record Positions

Every message carries exact DB record positions:
- **Summary request:** `from_id` and `to_id` for the range being summarized
- **Summary response:** model includes message IDs in the summary text
- **Compact message:** summary ID, tail message IDs, session ID

The agent uses `session-read` with these IDs for exact retrieval — never guesses.

### Removed

| Component | Reason |
|-----------|--------|
| Compaction agent (`agent.ts`) | No separate agent needed |
| `compactionTier()` (soft/full/force ratios) | No tier system |
| `select()` / `selectMessages()` | No head/tail splitting |
| `chunkHead()` | No chunking |
| `prune()` (tool output compaction) | No tool output pruning |
| `validateSummary()` | No validation needed |
| Stuck detection | No stuck state |
| `CompactionPart` injection | Pruning is direct via `removeMessage()` |
| Compaction checks in `llm.ts` | No special agent mode |

### Files Changed

| File | Change |
|------|--------|
| `agent.ts` | Removed compaction agent definition |
| `llm.ts` | Removed `agent.name === "compaction"` checks |
| `overflow.ts` | Removed `compactionTier()` |
| `compaction.ts` | Rewrote: `compact()`, `injectSummaryRequest()`, `isOverflow()`. Removed `select()`, `prune()`, `chunkHead()`, `extractAnchors()`, `validateSummary()` |
| `prompt.ts` | Replaced compaction agent path with overflow→compact(). Added token tracking + summary injection. Updated system-reminder. |
| `session.ts` (httpapi) | `create()` → `compact()` |
| `compaction.test.ts` | 42 tests: 11 new, deleted dead test groups |
| `opencode_prompts_kernel.py` | Removed COMPACTION spec, CONTRACTS, PACKS |
| `opencode_prompts_kernel.txt` | Regenerated without COMPACTION |
| `test_reasoning_kernel.py` | Updated spec count 33→32 |

### Message Templates

**Summary request** (`injectSummaryRequest`):
```
Please create a structured summary of the conversation from `msg_X` to `msg_Y`.
Include these message IDs: from_id: `msg_X`, to_id: `msg_Y`.
Output ONLY the structured summary sections starting with ## Goal.
```

**Compact message** (`compact`):
```
Your context has been compacted. Use session-read for precise history recall.
Summary: assistant `msg_S` covers the conversation up to that point.
Active context: messages `msg_T1` through `msg_TN`.
Use messagesearch with query keywords to find pruned content.
Use session-read with sessionId: "ses_xxx" for exact retrieval.
```

**System-reminder** (`insertReminders`):
```
Your conversation history was compacted to stay within context limits.
A structured summary of previous work is in the assistant message above.
Use messagesearch without a query to browse recent messages.
Use session-read with specific message IDs from the summary for exact retrieval.
```
