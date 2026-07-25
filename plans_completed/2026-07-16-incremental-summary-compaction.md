# Plan: Incremental Summary + Mechanistic Compaction

**Date:** 2026-07-16  
**Updated:** 2026-07-17  
**Status:** ✅ Implemented

**Canonical docs:** `docs/compaction.md`, `docs/architecture.md` § Mechanistic Compaction, `AGENTS.md` (checkpoint/compaction)

---

## Why (information theory, not “better prompting”)

Neither humans nor LLMs can losslessly compress 500K tokens of nuanced context into a single summary. A one-shot “summarize everything” produces **memory soup** — vague or wrong text that then becomes the only memory. The agent **loses track**.

**Mechanistic design:** summarize small ~30K segments; every summary carries **hard links** for `session-read`. Soft-hide into `message*`; **never delete**. Even imperfect summary text remains a **handle** to recover ground truth. Memory is **stable and continuous**.

```
active working set  = message* + recent s/m
addressable archive = full DB (soft-hidden from context, tools can read)
```

---

## Architecture (implemented)

```
every ~30k output → injectSummaryRequest → model writes s (with links)

(m,m,m,s,m,m,s,m,m,m)
        ↓ compact()
message* = (s,s, recent m…)     ← only visible memory
        ↓ growth
(m*, s, m, m, s, m, m)
        ↓ compact again
message** = (s…, recent m…)
```

### Layer 1: Incremental summaries (~32K output tokens)

`prompt.ts` `runLoop` tracks `outputTokensSinceLastSummary` on **normal continues** (not nested under the compact branch). At threshold:

- `injectSummaryRequest()` — synthetic user message with `from_id` / `to_id` / `session_id`
- Open range larger than ~30K content → trim `from_id` to last interval
- Model responds normally; `assistant.summary = true`; tools blocked except `skill`

### Layer 2: Algorithmic compact (overflow)

- Collect **all** `summary: true` assistants from full DB (including soft-hidden)
- Soft-hide every **visible** message (`info.compacted = true`) — **no `removeMessage`**
- Inject one user `message*` (`=== COMPACTED ===`) = summaries (with IDs) + recent after last summary
- Prior `message*` bodies are skipped when rebuilding (no nested dump)
- Idempotent if only a lone `message*` remains
- Multi-round: growth after `message*` allows compact again (no permanent `anyCompacted` skip)

### Layer 3: Continuous memory

- Summary request + summary text + `message*` all embed message IDs / `session_id`
- Agent uses `session-read` and `messagesearch` to regain detail on the fly

### Checkpoint

- `Checkpoint.remove` on compact; next successful turn saves compacted visible state

---

## Removed (historical)

| Component | Reason |
|-----------|--------|
| Compaction agent | No separate agent; summaries run in main agent |
| Hard `removeMessage` prune | Soft-hide only; archive must survive |
| Permanent “already compacted” global skip | Broke multi-round loop |
| Soft/full/force tier system | Replaced by overflow + interval |
| `CompactionPart` injection | Soft-hide + `message*` only |

---

## Files

| File | Role |
|------|------|
| `session/compaction.ts` | `compact`, `injectSummaryRequest`, `isOverflow` |
| `session/prompt.ts` | Token accumulate, overflow→compact, reminder |
| `session/overflow.ts` | Overflow detection |
| `session/message-v2.ts` | `filterCompacted*` |
| `session/processor.ts` | Provider overflow → `"compact"`; summary tool gate |
| `test/session/compaction.test.ts` | Loop coverage |
| `docs/compaction.md` | Canonical design doc |

---

## Acceptance

- [x] Layer 1 runs on normal continues
- [x] `message*` is sole visible set after compact; messages not deleted
- [x] Re-compact after `(m*, m)` growth
- [x] Summary / `message*` carry session-read links
- [x] Docs: `docs/compaction.md`, architecture, AGENTS.md
- [x] `bun test test/session/compaction.test.ts` passes
