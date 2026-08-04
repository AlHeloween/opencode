# KV Cache Diff Logging System

**Goal:** Debug KV cache misses by logging unified diffs between consecutive LLM requests. Every diff shows exactly what changed in the system prompt and conversation messages between turns.

**Status:** completed

---

## Architecture

```
prompt.ts request assembly
  |
  +-> formatRequest(system, modelMsgs, meta) → formatted text blob
  +-> diff vs previous formatted text → unified diff
  +-> write to diffs/{ISO8601-ms}_{provider}_{model}.diff
  +-> store current text as baseline for next turn
```

### Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| What to diff | Formatted text of system + modelMsgs | Exact bytes sent to provider (post-plugin transform) |
| Diff format | Section-aware structural diff (META/SYSTEM/MESSAGES) | Compact, section-scoped, human-readable |
| Baseline | Previous request in same session | Only meaningful to compare same-session consecutive turns |
| Storage | `.opencode/data/diffs/` folder | Gitignored, per-project data directory |
| Default | Enabled | KV cache debugging is critical; minimal perf impact |
| Max diffs per session | 200 (FIFO per-model) | Prevent unbounded disk growth |

---

## Bug Discoveries & Fixes

### Bug 1 — Duplicate compaction text (`message-v2.ts:844-849`)
`toModelMessagesEffect` appended `"What did we do so far?"` as a second text part when encountering a `compaction` part. The first text part already contained the full summary prompt. Fix: compaction parts now `continue` (skip).

### Bug 2 — System array mutated by reference (`prompt.ts`)
The `system` array was passed by reference to `handle.process()`. The plugin hook in `llm.ts` mutated it in place. `formatRequest` was called AFTER `handle.process()`, capturing post-mutation array with injected conversation content. Fix: `const systemForDiff = [...system]` snapshot before `handle.process()`.

### Bug 3 — `msgConversionCache` test contamination (`message-v2.ts:743`)
Module-level `Map<string, UIMessage>` keyed by `${messageID}:${modelID}:...`. Test fixtures reuse hardcoded IDs (`"m-user"`, `"m-assistant"`), causing cross-test-cache poisoning (12 of 27 tests failed). Production safe (ascending time-based IDs never collide). Fix: exported `clearConversionCache()`; added `beforeEach` clearing in test suite.

---

## Implementation Tasks

### 1. Create `src/session/request-diff.ts` (new file)

**Abstract:** Module that formats LLM requests as diffable text and generates unified diffs.

**Functions:**

```
formatRequest(system: string[], modelMsgs: ModelMessage[], meta: { sessionID, modelID, providerID, turn, agent }): string
  Returns formatted text like:
    === META ===
    session: ses_xxx
    model: provider/model
    agent: build
    turn: 5
    === SYSTEM ===
    [session: ses_xxx]
    ...rules...
    === MESSAGES ===
    [user] hello
    [assistant] hi there
    ...

diffRequest(prev: string, curr: string, prevMeta, currMeta): string
  Wraps unifiedDiff with ---/+++ headers containing turn numbers + timestamps.
  Returns empty string when prev is empty (first request).

writeDiff(content: string, meta): string (filepath)
  Creates diffs/{ISO8601-ms}_{provider}_{model}.diff
  Returns absolute file path.
```

**Dependencies:**
- `unifiedDiff` — copied/imported from `src/provider/gateway/adaptive-client.ts:137-180`
  OR extracted to `src/util/unified-diff.ts` shared utility
- `md5` from `src/session/cache-control.ts` (already imported there)

### 2. Add config toggle

**File:** `src/config/config.ts`

Add to the `Info` Zod schema (near `snapshot` at line 117):

```ts
diff_requests: Schema.optional(Schema.Boolean).annotate({
  description:
    "Log unified diffs between consecutive LLM requests to diffs/ folder for KV cache debugging. Defaults to true.",
}),
```

### 3. Hook into `prompt.ts` send loop

**File:** `src/session/prompt.ts`

Two injection points (normal turn + compaction turn), both placed **after `handle.process()` returns**, where `system` (post-plugin transform) and `modelMsgs` are accessible. Config is accessed via `yield* config.get()` (Effect dependency injection pattern already in use at line 100 of prompt.ts).

**Injection code** (placed right after `storePrevFingerprint()` at ~line 1514 in normal branch, ~line 1295 in compaction branch):

```ts
const cfg = yield* config.get()
if (cfg.diff_requests !== false) {
  const formatted = RequestDiff.formatRequest(system, modelMsgs, {
    sessionID,
    modelID: model.id,
    providerID: model.providerID,
    turn: turnIndex,
    agent: agent.name,
  })
  const prev = RequestDiff.getPrev(sessionID)
  if (prev) {
    const diff = RequestDiff.diffRequest(prev.formatted, formatted, prev.meta, meta)
    if (diff) {
      RequestDiff.writeDiff(diff, {
        sessionID,
        modelID: model.id,
        providerID: model.providerID,
        turn: turnIndex,
        timestamp: Date.now(),
      })
    }
  }
  RequestDiff.storePrev(sessionID, formatted, meta)
}
```

**Why after `handle.process()`:** The `experimental.chat.system.transform` plugin in `llm.ts` modifies `system` by reference during `handle.process()`. Capturing after gives the actual bytes the provider received. `modelMsgs` is unchanged by the call — same reference before and after.

**What we diff:** `system` (string[], post-plugin) + `modelMsgs` (ModelMessage[], post-conversion). Both represent the exact content sent to the provider.

### 4. Extract `unifiedDiff` to shared utility

**File:** `src/util/unified-diff.ts` (new)

Move the `unifiedDiff` function from `src/provider/gateway/adaptive-client.ts:137-180` to a shared location so both the gateway and request-diff can use it.

Update `adaptive-client.ts` to import from shared location.

### 5. Clean rotation

`RequestDiff.writeDiff()` tracks count per session. After 200 diffs written, FIFO removes oldest.

### 6. Tests

**File:** `packages/opencode/test/session/request-diff.test.ts`

Test cases:
- `formatRequest` produces deterministic output for same system+messages
- `diffRequest` returns empty string for first (no-baseline) request
- `diffRequest` produces unified diff showing additions only (system unchanged, new message added)
- `diffRequest` produces unified diff showing system changes (simulates agent switch)
- `writeDiff` creates file at correct path with correct naming convention
- Config toggle `diff_requests: false` suppresses all diff output
- 200+ diffs FIFO rotation works

---

## File Layout

```
packages/opencode/src/
  session/
    request-diff.ts          ← NEW: formatRequest, diffRequest, writeDiff, storePrev, getPrev
  util/
    unified-diff.ts          ← NEW: shared unifiedDiff (extracted from gateway)
  config/
    config.ts                ← MODIFIED: add diff_requests boolean
  session/
    prompt.ts                ← MODIFIED: hook into send loop

packages/opencode/test/
  session/
    request-diff.test.ts     ← NEW: tests

diffs/                       ← NEW runtime folder (created on first use)
  .gitkeep
```

---

## KV Cache Continuity Assessment

[KV-CACHE SAFE] This is a read-side logging addition. It does not modify:
- System prompt construction
- Agent resolution
- Message conversion (`toModelMessagesEffect`)
- `streamText()` parameters
- Any content sent to the LLM provider

The only overhead is formatting + disk I/O after the request is already assembled, with zero impact on the bytes sent to the provider.

---

## Completion Criteria

- [x] `src/util/unified-diff.ts` extracted from adaptive-client.ts (added context-window collapsing)
- [x] `adaptive-client.ts` imports from shared utility
- [x] `src/session/request-diff.ts` with section-aware diff (META key-by-key, SYSTEM line-level, MESSAGES hash-based)
- [x] `src/config/config.ts` diff_requests boolean (default true)
- [x] `src/session/prompt.ts` diff capture in both normal + compaction branches (systemForDiff snapshot)
- [x] Tests: `request-diff.test.ts` 18/18 pass
- [x] Typecheck clean
- [x] Bug 1 fixed: compaction duplicate text removed
- [x] Bug 2 fixed: systemForDiff snapshot prevents array mutation
- [x] Bug 3 fixed: clearConversionCache() with test beforeEach isolation
- [x] `message-v2.test.ts`: 26/27 pass (1 pre-existing: OpenRouter reasoning + applyCaching)
- [x] Diffs directory: `.opencode/data/diffs/` (gitignored, per-project)
- [x] `index.md` updated with diffs/ folder description
