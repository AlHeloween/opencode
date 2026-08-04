# Chunked Compaction + Quality Guard + Searchable Anchors

## Problem

1. **Cross-model sessions unrecoverable:** When switching from a 1M-context model to a 200K model and 500K tokens of history need compaction, the head (all turns before the last one, ~490K tokens) exceeds the new model's usable window (170K). The summarizer itself overflows, triggering recursive `result === "compact"` loops until stuck detection fires — a diagnostic event with no recovery mechanism.

2. **"nothing to add" destroys memory:** The compaction system trusts the summarizer LLM unconditionally. If a model returns an empty response, "nothing to add", or a placeholder, the entire head is replaced with garbage. No validation exists.

3. **messagesearch degraded after compaction:** The `SUMMARY_TEMPLATE` asks for file paths and errors, but there's no enforcement and no keyword extraction. Epistemic markers (Exact/Inferred/etc.) from the original conversation are lost — only the summary gets re-classified by `classifyText()`. If the summarizer omits key terms, messagesearch can't find compacted content.

## Solution Overview

| # | Feature | File(s) | Lines |
|---|---------|---------|-------|
| 1 | Chunked head summarization | `compaction.ts`, `prompt.ts` | +80 |
| 2 | Summary quality guard | `prompt.ts` | +40 |
| 3 | Searchable anchor extraction | `compaction.ts` | +50 |

---

## Feature 1: Chunked Head Summarization

### Goal

When `estimateContentTokens(head)` exceeds the model's usable window, split the head into chunks, summarize each independently, then merge the summaries.

### Chunking Algorithm

```
CHUNK_TARGET = usable * 0.5  // Leave 50% for prompt overhead + output

function chunkMessages(messages, model, usable):
  chunks = []
  currentChunk = []
  currentTokens = 0

  for msg in messages:
    msgTokens = estimateContentTokens([msg], model)
    if currentTokens + msgTokens > CHUNK_TARGET && currentChunk.length > 0:
      chunks.push(currentChunk)
      currentChunk = [msg]
      currentTokens = msgTokens
    else:
      currentChunk.push(msg)
      currentTokens += msgTokens

  if currentChunk.length > 0: chunks.push(currentChunk)
  return chunks
```

Example for 490K head on 200K model (usable = 170K, CHUNK_TARGET = 85K):
- Chunk 1: oldest ~85K tokens of head → summarized → summary_1
- Chunk 2: next ~85K tokens of head → summarized → summary_2
- Chunk 3: next ~85K tokens of head → summarized → summary_3
- ...continue...
- Merge: summary_1 through summary_N → merged_summary

### Merge Prompt

```
Combine these multiple conversation summaries into one coherent summary. Remove duplicate information. Preserve all file paths, commands, errors, decisions, and next steps.

<summary-1>
...chunk_1_summary...
</summary-1>
<summary-2>
...chunk_2_summary...
</summary-2>

Produce the final summary using the same structure.
```

### Integration Point

**File:** `packages/opencode/src/session/compaction.ts`

Add a new export `chunkIfNeeded`:
```ts
export function chunkIfNeeded(input: {
  head: MessageV2.WithParts[]
  cfg: Config.Info
  model: Provider.Model
}): { needsChunking: boolean; chunks: MessageV2.WithParts[][] }
```

**File:** `packages/opencode/src/session/prompt.ts` (inside compaction task processing, after line 1271)

```ts
selected = yield* compaction.selectMessages({ messages: msgs, model })
// NEW: chunk head if it exceeds model capacity
const headTokens = estimateContentTokens(selected.head, model)
if (headTokens > usable({ cfg: yield* config.get(), model }) * 0.7) {
  const { chunks } = chunkIfNeeded({ head: selected.head, cfg: yield* config.get(), model })
  // Process chunks sequentially, merge at the end
  // ...
}
```

### TUI Progress Event

Add `CompactionChunkProgress` event to `compaction.ts:Event`:
```ts
CompactionChunkProgress: BusEvent.define(
  "session.compaction.chunk_progress",
  Schema.Struct({
    sessionID: SessionID,
    chunk: Schema.Number,
    total: Schema.Number,
  }),
),
```

---

## Feature 2: Summary Quality Guard

### Validation Rules

After the compaction summarizer returns, validate the summary text:

1. **Minimum length:** `summaryText.length >= 200` chars
2. **Structural completeness:** Contains at least 2 of the `SUMMARY_TEMPLATE` section headers (`## Goal`, `## Commands & Outcomes`, `## Errors & Fixes`, `## Relevant Files`, etc.)

### Retry Flow

```
validateSummary(text):
  if text.length < 200: return { valid: false, reason: "too_short" }
  headers = count matching "## Goal|## Commands|## Errors|## Relevant|## Key Decisions|## Critical Context"
  if headers < 2: return { valid: false, reason: "no_structure" }
  return { valid: true }

On invalid:
  retryCount++
  if retryCount <= 2:
    retry with strictPrompt (adds "You MUST include file paths, commands, and errors.")
  else:
    FALLBACK: oldest-turn truncation
```

### Strict Retry Prompt

```
You MUST include at minimum: file paths, commands that were run, errors encountered, and key decisions made.
Do NOT respond with "nothing to add", "summarized", or any placeholder text.
Fill every section of the template with actual content from the conversation.
```

### Fallback: Oldest-Turn Truncation

If the model refuses to produce a valid summary after 2 retries:
1. Drop the oldest turns from the head, keeping only the most recent N turns that fit within the usable window
2. Insert a note line: `[Earlier conversation truncated to fit context window]`
3. This preserves at least the recent context rather than losing everything to a placeholder summary

### Integration Point

**File:** `packages/opencode/src/session/prompt.ts` (after line 1403, before line 1405)

```ts
// Quality guard: validate summary is substantive
const summaryText = handle.message.parts
  .filter((p): p is MessageV2.TextPart => p.type === "text")
  .map(p => p.text).join("\n\n")

const quality = validateSummary(summaryText)
if (!quality.valid) {
  log.warn("bug: compaction produced invalid summary", { reason: quality.reason })
  if (compactionRetries < MAX_QUALITY_RETRIES) {
    compactionRetries++
    // Create a new compaction task with strict prompt
    yield* compaction.create({ ..., forced: true })
    return "continue" as const
  }
  // Fallback: truncate oldest turns
  yield* truncateHeadPreservingRecent({ ... })
}
```

---

## Feature 3: Searchable Anchor Extraction

### Goal

Before summarizing, scan the head for searchable anchors (file paths, commands, error strings) and inject them into the summary prompt so the summarizer preserves them.

### Extraction Logic

**File:** `packages/opencode/src/session/compaction.ts` — new function `extractAnchors`

```ts
function extractAnchors(messages: MessageV2.WithParts[]): string[] {
  const text = messages.flatMap(m => m.parts)
    .filter(p => p.type === "text" || p.type === "tool" || p.type === "reasoning")
    .map(p => "text" in p ? p.text : "output" in p.state ? p.state.output : "")
    .join("\n")

  const anchors = new Set<string>()

  // File paths: src/foo/bar.ts, packages/**/*, *.json, etc.
  for (const match of text.matchAll(/\b(?:[\w-]+\/)*[\w-]+\.(?:ts|tsx|js|jsx|json|md|sql|css|html|rs|go|py)\b/g)) {
    if (match[0].length > 3) anchors.add(match[0])
  }

  // Error strings: "Error: ...", "error: ...", "Cannot ...", "Failed ..."
  for (const match of text.matchAll(/(?:Error|error|Cannot|Failed|Unable|TypeError|ReferenceError)[^\n]{0,80}/g)) {
    const trimmed = match[0].trim()
    if (trimmed.length > 5) anchors.add(trimmed)
  }

  // Commands: bun, npm, git, cargo, python, etc.
  for (const match of text.matchAll(/\b(bun|npm|npx|git|cargo|python|node|docker|kubectl|migrate|generate|drizzle)\s+[^\n]{0,60}/g)) {
    anchors.add(match[0].trim())
  }

  // Deduplicate and limit to reasonable size
  return [...anchors].slice(0, 30)
}
```

### Prompt Injection

**File:** `packages/opencode/src/session/compaction.ts` — extend `buildInstruction()`

```ts
function buildInstruction(input: {
  previousSummary?: string
  context: string[]
  anchorKeywords?: string[]
}) {
  const anchor = input.previousSummary ? ... : ...
  const keywordsSection = input.anchorKeywords?.length
    ? `\n\nIMPORTANT: The following terms were extracted from the conversation. Include them in your summary so they remain searchable:\n${input.anchorKeywords.join(", ")}`
    : ""
  return [anchor + keywordsSection, ...input.context].join("\n\n")
}
```

### Integration Point

**File:** `packages/opencode/src/session/compaction.ts` — inside the `create()` function, before creating the compaction message

```ts
// Extract searchable anchors from the head
const anchors = extractAnchors(headMessages)
// Pass to buildInstruction when constructing the prompt
const instruction = buildInstruction({ ..., anchorKeywords: anchors })
```

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `packages/opencode/src/session/compaction.ts` | Add `chunkIfNeeded()`, `extractAnchors()`, extend `buildInstruction()`, add `CompactionChunkProgress` event | +120 |
| `packages/opencode/src/session/prompt.ts` | Add chunking call site after select, add quality guard, add truncation fallback | +80 |
| `packages/opencode/test/session/compaction.test.ts` | Tests for chunking, quality guard, anchor extraction | +100 |

## Verification

1. **Typecheck:** `bun typecheck` — must pass
2. **Existing tests:** `bun test test/session/compaction.test.ts` — all 47 existing tests must pass
3. **Chunking unit test:** Create 500K-token head, verify `chunkIfNeeded` splits into correct number of chunks, each under CHUNK_TARGET
4. **Quality guard unit test:** Pass short/empty summary, verify retry triggers; pass valid summary, verify no retry
5. **Anchor extraction unit test:** Pass head with known file paths and errors, verify extracted anchors include them
6. **Integration:** `cmd_runner` TUI test — long cross-model session, verify compaction succeeds without provider overflow, messagesearch finds compacted content

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Chunking + merging increases LLM cost (N chunk calls + 1 merge call) | Only triggers when `headTokens > usable * 0.7`; normal sessions unaffected; session would be dead otherwise |
| Chunk boundary splits turns mid-conversation | Chunk at message boundaries only; use `turns()` to find safe split points |
| Retry loop with strict prompt still fails | Max 2 retries, then fallback to truncation — preserves recent context at minimum |
| Anchor extraction misses important terms | Anchors are additive — they help when extracted, don't hurt when missed |

## Implementation Order

1. **compaction.ts** — Add `CompactionChunkProgress` event, `CHUNK_THRESHOLD_RATIO`/`CHUNK_TARGET_RATIO`/`MIN_SUMMARY_LENGTH`/`SECTION_HEADERS` constants, `chunkHead()`, `extractAnchors()`, and `validateSummary()` functions
2. **prompt.ts** — After `selected` is computed (line 1271): check if head needs chunking, loop through chunks calling `handle.process()` per chunk; after result returns (line 1403): add quality guard validation; publish `CompactionChunkProgress` events
3. **Tests** — Add tests in `compaction.test.ts` for chunkHead, extractAnchors, validateSummary

## Notes from Validation

- `buildInstruction()` and `SUMMARY_TEMPLATE` are defined in compaction.ts lines 58-155 but **never called** — they are dead code. The actual compaction instruction is the simple text part at line 367: `"Please create a structured summary of the conversation history..."`. The chunked summarization does not depend on these.
- `TokenCalibration.getObservedLimit` is importable from `./token-calibration` (not currently imported in compaction.ts)
- The compaction loop is at prompt.ts:1144 (not 1200 as initially stated)
