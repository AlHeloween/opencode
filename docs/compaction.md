# Mechanistic Compaction — Stable Continuous Memory

**Status:** production  
**Last updated:** 2026-07-23  
**Code:** `packages/opencode/src/session/compaction.ts`, `prompt.ts` (`runLoop`), `summary.ts`, `overflow.ts`, `message-v2.ts` (`filterCompacted*`)

---

## Model vs system (non-negotiable)

Asking a model to invent **digital facts** (message IDs, session IDs, diffs, hashes, DB offsets) is the wrong instrument — same class of error as asking it to guess a SHA-256. Those values are produced by **code**, not prose.

### Model generates (Inferred narrative only)

| Output | Role |
|--------|------|
| `## Semantic Vector` | dominant + key_phrases (Σ=1.0) — sparse intent for FTS / chain |
| `## Goal` | what the user was trying to do in the window |
| `## Key decisions` | decision lines (later preserved verbatim by system across compact) |
| `## Current state` | done / in progress / remaining |

That is **all** the Layer-1 summary request asks the model to write. No IDs, no diffs, no tool recipes, no “include these message IDs.”

### System generates (Exact machinery)

| Output | How / where |
|--------|-------------|
| Open-window **counter** | `computeOpenWindowTokens` — `chars/4` since last summary / of visible set |
| **When** to inject Layer-1 | Counter ≥ `SUMMARY_INTERVAL_TOKENS` (32 768) on stop + continue + pre-overflow |
| Summary **range** `from_id` / `to_id` / `session_id` | Ignored text part: `<!-- summary-range … -->` — **not** sent to the model (`toModelMessages` skips `ignored`) |
| Model-facing inject prose | Synthetic non-ignored part: SVM/goal/decisions/state template only |
| `assistant.summary = true` | Flag on the next assistant so the reply is the Layer-1 summary |
| **Exact stamp** after summary | Synthetic part on the summary assistant: `summary_message_id`, `from_id`, `to_id`, `session_id` (from ignored marker + DB id) |
| **File diffs** for the window | `SessionSummary.summarize` → fossil/tool `computeDiff` over `from_id`…`to_id` → `user.summary.diffs` + session Modified Files |
| **Structural detail** | CodeGraph / fossil `sym` tags / `Snapshot.impact` — not model text |
| **`message*` body** | Entire `=== COMPACTED ===` artifact: system links, decisions block, Recent fold, recovery recipes |
| Soft-hide / `compacted` | System flags; never hard-delete |
| Prior `message*` chain, `#N` offsets | System when building the next star |
| Decisions block on star | System extracts `## Key decisions` from summary bodies and copies them |

```
┌─────────────────────────────────────────────────────────────┐
│  MODEL (Inferred)                                           │
│    Semantic Vector · Goal · Key decisions · Current state   │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  SYSTEM (Exact)                                             │
│    range IDs · counter · stamps · soft-hide · message*      │
│    fossil diffs · CodeGraph structure · session-read links  │
└─────────────────────────────────────────────────────────────┘
```

### Anti-pattern (forbidden)

| Never | Why |
|-------|-----|
| Ask the model to echo `from_id` / `to_id` / `session_id` | Digits are not model-reliable |
| Ask the model to produce file diffs or hashes | Fossil / CodeGraph own Exact change |
| Trust summary prose as Exact ground truth | Inferred until `session-read` / diff / graph |
| Hide `message*` from the user UI | Model memory must stay observable |

---

## Why this exists

### Non-mechanistic (lossy “memory soup”)

1. Stuff ~500k tokens into the model.
2. Say “summarize everything.”
3. Hope the result is accurate.

That compression ratio exceeds what information theory allows for actionable detail. The model produces a **randomized soup** (vague, incomplete, or wrong). That blob then **becomes memory**. The agent loses track of reality because the archive was rewritten into a single unreliable narrative.

### Mechanistic (stable continuous memory)

1. Summarize **small ~30k segments** regularly — a bounded job (model = prose).
2. Each summary is imperfect prose, but **system** always attaches **hard links** (`from_id`, `to_id`, `summary_message_id`, `session_id`) and range **diffs**.
3. On overflow, **system** folds history into one active **`message*`** of `(s, s, s, recent m…)`.
4. **Never delete** messages. Soft-hide them from the model context; full DB remains for `session-read` / `messagesearch`.

**Key benefit:** even a thin summary is a **handle**, not a final rewrite of the past. Exact recovery is system + archive, not model recall.

```
active working set  =  message* + recent s/m
addressable archive =  all messages in DB (soft-hidden from context, still readable)
```

---

## Loop

```
counter = content tokens (chars/4) of open window since last summary
         (or whole visible window if no summary yet)     ← SYSTEM

every time counter ≥ ~32_768
    → SYSTEM: inject ignored range marker + prose request
    → MODEL: writes s (SVM / goal / decisions / state only)
    → SYSTEM: stamp Exact links; attach fossil diffs for range
    → open window restarts after s  (counter effectively 0)

(m, m, m, s, m, m, s, m, m, m)
        ↓ overflow → SYSTEM compact()
message* = (s, s, recent m…)     ← only visible memory (system artifact)
        ↓
counter := len(message*)/4       ← same counter, not a special branch
        ↓ + new m… grows open window
        ↓ when counter ≥ ~32k (at once if message* already large, or later)
(m*, s, m, m …)
        ↓ compact again
message** = (s…, recent m…)
        → counter := len(message**)/4 again
```

There is **no** separate rule "if message* > 32k". After compact there is no summary after the star yet, so the open window *is* the star body: **message* length/4 becomes the Layer-1 counter**. The normal ≥ ~32k threshold then fires either immediately or after more messages.

Idempotent: if the only visible message is already a lone `message*`, compact is a no-op until growth.

---

## Layers

| Layer | Trigger | Action |
|-------|---------|--------|
| **1. Incremental summary** | Open-window **counter** ≥ ~32 768 | **System** injects request (ignored range + prose). **Model** writes SVM / Goal / Key decisions / Current state. **System** stamps Exact IDs and attaches **fossil**/tool diffs for `from_id`…`to_id`; structural detail via **CodeGraph**. |
| **2. Algorithmic compact** | Context overflow (`isOverflowFromContent` / provider overflow → `"compact"`) | **System only:** soft-hide visible messages; build `message*` = summaries (with system links) + Recent; prior star not re-nested. |
| **3. Continuous memory** | Agent needs detail | **System tools:** `session-read` by ID, `messagesearch`, fossil diff, CodeGraph — not unaided model memory. |

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
| User-facing compaction notifications | Mechanistic — no soft warnings, no "struggling" toasts. When context is full, compact runs. |
| Model-authored Exact IDs / diffs / hashes | System + fossil + CodeGraph only |

---

## Message shapes

### Layer-1 summary request (synthetic user — two parts)

| Part | Flags | Author | Content |
|------|-------|--------|---------|
| Range marker | `synthetic` + **`ignored`** | **System** | `<!-- summary-range from_id="…" to_id="…" session_id="…" -->` — not in model context |
| Prose request | `synthetic` | **System template → model answers** | Instructs **Inferred only**: Semantic Vector, Goal, Key decisions, Current state. Prior dominant hint optional. **No** “echo these IDs.” |

### Summary assistant (`assistant.summary = true`)

| Piece | Author |
|-------|--------|
| Body: SVM / Goal / Key decisions / Current state | **Model** |
| `--- Exact (system) ---` stamp (`summary_message_id`, `from_id`, `to_id`, `session_id`) | **System** (after reply completes) |
| `user.summary.diffs` on the range parent (file list +/−) | **System** via fossil/tool `computeDiff` over the range |

### `message*` (synthetic user, starts with `=== COMPACTED ===`)

Entire body is a **system** artifact:

- Summary blocks: model body + **system** link lines (IDs from ignored parent range, not model prose)
- `Prior message*: <id>` — system chain
- `--- Decisions ---` — system copy of model decision lines
- Recent fold — system faithful render of parts (including tool outputs) after last summary
- Recovery recipes (`session-read`, `db-read`, fossil, git) — system text

**Visibility:** `MessageV2.filterCompacted` / `filterCompactedEffect` skip `info.compacted === true`. Soft-hidden rows stay in SQLite for tools.

**User-visible model memory:** `message*` is synthetic (not typed user input for undo/fork) but TUI/web UI **must render it** (e.g. “Model memory (message*)”). Hiding it makes post-compact behavior unobservable. Other synthetic traffic (system-reminders, ignored range marker) stays hidden from the human transcript.

**message* detection:** match only text that **starts with** `=== COMPACTED ===`. Do not use `.includes()` — post-compact reminders must never embed that literal marker.

---

## Key files

| File | Role |
|------|------|
| `session/compaction.ts` | `injectSummaryRequest` (ignored range + prose), `compact` / `message*`, open-window counter, decision preservation |
| `session/summary.ts` | `parseSummaryRange`, range `computeDiff` (fossil/tool), `user.summary.diffs` |
| `session/prompt.ts` | Layer-1 inject sites; Exact stamp after summary assistant; overflow → compact |
| `session/overflow.ts` | Content-based overflow |
| `session/message-v2.ts` | `filterCompacted*`, `ignored` parts skipped for model; `compacted` / `summary` fields |
| `snapshot/fossil.ts` | Exact file diffs; structural tags / impact (CodeGraph) |
| `test/session/compaction.test.ts` | Loop + model/system inject split |
| `test/session/summary.test.ts` | Range parse + range diffs |

---

## Tests

```bash
cd packages/opencode
bun test test/session/compaction.test.ts
```
