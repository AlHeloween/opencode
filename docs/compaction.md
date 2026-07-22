# Mechanistic Compaction — Stable Continuous Memory

**Status:** production  
**Last updated:** 2026-07-22  
**Code:** `packages/opencode/src/session/compaction.ts`, `prompt.ts` (`runLoop`), `overflow.ts`, `message-v2.ts` (`filterCompacted*`)

---

## Why this exists

### Non-mechanistic (lossy “memory soup”)

1. Stuff ~500k tokens into the model.
2. Say “summarize everything.”
3. Hope the result is accurate.

That compression ratio exceeds what information theory allows for actionable detail. The model produces a **randomized soup** (vague, incomplete, or wrong). That blob then **becomes memory**. The agent loses track of reality because the archive was rewritten into a single unreliable narrative.

### Mechanistic (stable continuous memory)

1. Summarize **small ~30k segments** regularly — a bounded job.
2. Each summary may be imperfect, but it always carries **hard links** (`from_id`, `to_id`, `summary_message_id`, `session_id`).
3. On overflow, fold history into one active **`message*`** of `(s, s, s, recent m…)`.
4. **Never delete** messages. Soft-hide them from the model context; full DB remains for `session-read` / `messagesearch`.

**Key benefit:** even a thin summary is a **handle**, not a final rewrite of the past. The agent recovers detail on the fly. Memory stays **stable and continuous**.

```
active working set  =  message* + recent s/m
addressable archive =  all messages in DB (soft-hidden from context, still readable)
```

---

## Loop

```
every ~30k output tokens
    → injectSummaryRequest(from_id, to_id, session_id)
    → model writes summary s (assistant.summary = true, with links)

(m, m, m, s, m, m, s, m, m, m)
        ↓ overflow → compact()
message* = (s, s, recent m…)     ← only visible memory
        ↓ work continues
(m*, s, m, m, m, s, m, m …)
        ↓ compact again
message** = (s…, recent m…)
```

Idempotent: if the only visible message is already a lone `message*`, compact is a no-op until growth.

---

## Layers

| Layer | Trigger | Action |
|-------|---------|--------|
| **1. Incremental summary** | ~32 768 output tokens since last summary | `injectSummaryRequest()` — synthetic user message with ID range. **Every summary must open with `## Semantic Vector`** (dominant + key_phrases Σ=1.0) for FTS/ranking and `sv_dominant` chaining; then Goal / Key decisions / Current state. Prior dominant is injected when known. If the open range exceeds ~30k content, **trim to the last ~30k**. Model answers normally; all tools available, no restrictions. |
| **2. Algorithmic compact** | Context overflow (`isOverflowFromContent` / provider overflow → `"compact"`) | Collect all `summary: true` assistants from DB (including soft-hidden). Soft-hide every **visible** message. Inject one user `message*` = summaries + recent after last summary. Prior `message*` bodies are not re-nested. |
| **3. Continuous memory** | Agent needs detail | `session-read` with message IDs from summaries / Recent sections; `messagesearch` by topic. |

Checkpoints: after compact, checkpoint is **removed**; next successful turn saves a fresh checkpoint of the compacted visible set.

### Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auto` | boolean | `true` | Enable automatic compaction |
| `full_ratio` | number | `0.8` | Fraction of context window to trigger normal compaction |
| `force_ratio` | number | `0.9` | Fraction to force compaction, bypassing economics check |
| `reserved` | number | `min(20000, limit * 0.15)` | Token buffer so compaction has room to run |

Config is minimal by design — no soft warnings, no tail-turn knobs. The mechanistic loop handles the rest.

### Design details

**Decisions preservation.** `## Key decisions` lines from every summary are extracted and carried **verbatim** across compaction cycles. They appear in the `message*` as `--- Decisions (preserved verbatim across compaction cycles) ---`. The model never re-summarizes them — "Inferred once, not re-Inferred."

**message* chain linking.** Each `message*` embeds the ID of the prior `message*` (`Prior message*: <id>`). This forms a linked list through compaction history — older summaries are always recoverable via `session-read` by following the chain backward.

**Overflow detection.** Two paths trigger compaction:
1. **Content-based** (`isOverflowFromContent`): extracts actual text from message parts and runs it through the model's BPE tokenizer. Avoids 3–5× inflation from JSON structural overhead that would cause premature compaction on large-context models.
2. **Provider-forced** (`result === "compact"`): the model API returns a context-overflow error — compact immediately.

**Re-entrant guard.** `SessionStatus` prevents concurrent compaction. If a compact is already in progress (`type: "compacting"`), subsequent calls are silently skipped.

**Summary collection bounding.** Only summaries created **after** the last `message*` are collected into the new `message*`. Older summaries were already folded into prior cycles and are recoverable via the chain link. This keeps each `message*` O(1) instead of accumulating every summary from session start (O(n²)).

**SVM validation.** If a summary assistant lacks the required `## Semantic Vector` section, a debug log is emitted. The summary is still included but won't contribute `sv_dominant` to the chain.

### Checkpoint policy (pairs with this loop)

| Rule | Why |
|------|-----|
| Path system frozen until compact | Provider KV cache continuous; multi-project AGENTS.md/skills changes wait for a clean era boundary |
| `identityFingerprint` only kernel + agent prompt | Identity migrations rebuild without waiting for compact |
| One slot set per provider+model+agent+session | Model switch keeps each model's continuous memory; nothing lost |
| Message reuse via ID order + content fingerprints | In-place edits re-convert; pure appends stay cheap |
| Request-diff remembers last formatted request | First turn after compact still produces a useful `.diff` |

### Epistemic ranks (InfoMark)

Aligned with the reasoning kernel (`infomark`, `MEMORY.RANK`, `MEMORY.LINKS`):

| Surface | Rank | Meaning |
|---------|------|---------|
| `session-read` with message ID | **Exact** | Ground-truth archive |
| Summary assistants / summary sections in `message*` | **Inferred** | Lossy but linked |
| Recent fold in `message*` | **Mixed / Inferred** | Working context; re-read for Exact |
| Unaided model recall | **Guess** | Not trusted for completion claims |

Identity prefix is **Tier A** only (dictionary + agent/policy SPECS). Skills/commands are Tier B surfaces (`SKILL.md`), not permanent identity weight.

---

## What is never done

| Anti-pattern | Why |
|--------------|-----|
| Single-shot "summarize entire session" | Lossy soup; agent drifts |
| Hard-delete messages | Breaks recovery; archive is the ground truth |
| Separate sub-agent for compaction | Cache break, unreliable tool/reasoning behavior. Summaries are produced by the same agent the user was talking to — no agent switch, no KV discontinuity. |
| Permanent "already compacted" global skip | Breaks multi-round loop `(m*, …) → message**` |
| User-facing compaction notifications | Mechanistic — no soft warnings, no "struggling" toasts. When context is full, compact runs. The model doesn't see the machinery. |

---

## Message shapes

**Summary request** (synthetic user):

- Range: `from_id` … `to_id`, plus `session_id`
- **Required first section:** `## Semantic Vector` (dominant + key_phrases with weights, Σ=1.0) — sparse intent embedding for FTS ranking and `sv_dominant` chain
- Then Goal / Key decisions / Current state
- Prior summary’s dominant is injected when available so the model can link the chain
- Instructs model to embed those IDs in the summary for later `session-read`

**`message*`** (synthetic user, marker `=== COMPACTED ===`):

- Each summary block: text + `summary_message_id` / optional `from_id`/`to_id` / `session_id` / `sv_dominant`
- `Prior message*: <id>` chain link — follow backward via session-read to recover older summaries
- `--- Decisions ---` block: `## Key decisions` lines preserved verbatim across cycles (not re-summarized)
- Recent section: tagged `[role \`msg_id\` info_mark=Mixed]` lines + ID range for session-read
- Explicit note: older messages remain in DB; use session-read / messagesearch

**Visibility:** `MessageV2.filterCompacted` / `filterCompactedEffect` skip `info.compacted === true`. Soft-hidden rows stay in SQLite for tools.

**message* detection:** `isMessageStar` / `isCompactionBoundary` match only text that **starts with** `=== COMPACTED ===`. Do not use `.includes()` — the post-compact system-reminder used to mention that marker and was mis-classified as message*, which **dropped every real user message** from the next Recent fold (assistants only). Reminder wording must never embed the literal marker string.

---

## Key files

| File | Role |
|------|------|
| `session/compaction.ts` | `injectSummaryRequest`, `compact`, `isOverflow`, `SUMMARY_INTERVAL_TOKENS`, decision preservation, SVM validation |
| `session/prompt.ts` | Two overflow trigger sites: `isOverflowFromContent()` mid-loop + provider-forced `"compact"` result; checkpoint invalidate; system-reminder |
| `session/overflow.ts` | Content-based overflow (`isOverflowFromContent` — text extraction + BPE tokenizer to avoid JSON inflation) and token-based overflow (`isOverflow`) |
| `session/message-v2.ts` | `filterCompacted*`, message schema (`compacted`, `summary`), `CompactionPart` type |
| `test/session/compaction.test.ts` | Unit coverage for the loop |

---

## Tests

```bash
cd packages/opencode
bun test test/session/compaction.test.ts
```
