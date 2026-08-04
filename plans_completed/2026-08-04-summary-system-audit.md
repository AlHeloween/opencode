# Summary System: Trash Report

**Date**: 2026-07-30
**Source**: Code analysis + database evidence from `D:\zPython\!!!\` and `D:\zPython\opencode`

---

## What Should Happen

The codebase defines a two-tier summary system:

| Tier | Purpose | Trigger |
|------|---------|---------|
| Layer-1 | LLM writes a 4-section semantic summary (sidecar checkpoint) | Every ~65K content tokens |
| Layer-2 | Mechanistic fold of sidecars + messages into `message*` | When context approaches model limit |

When the user hits POST `/session/:id/summarize`, it force-compacts and loops.

---

## Trash 1: `injectSummaryRequest` is dead code

**File**: `compaction.ts:889-974`

Legacy Layer-1 path. It would inject a synthetic user message with `<!-- summary-range from_id="..." to_id="..." -->`, have the assistant write summary prose, set `message.summary = true`, and call `summary.summarize()`.

**No production code calls it.** Only `compaction.test.ts:1726`.

**Database**: Session `ses_04bfeebdeffe9q21JpVaW5G0zM` has 0 messages with `summary=true`. Across 114 sessions, the 32 existing `summary=true` messages all date from Jul 20-27 — before the sidecar migration disconnected this path.

---

## Trash 2: `maybeCaptureSidecar` stores invisible garbage

**File**: `prompt.ts:1159-1327`

The sidecar flow does everything right then stops dead:

1. Calls LLM with `toolChoice:"none"` → generates valid 4-section prose ✅
2. Validates with `diagnoseSummaryGaps` → sections pass ✅
3. Enriches with `summary.enrichRange()` → tool diffs + CodeGraph ✅
4. Calls `IncrementalCheckpoint.save()` → writes to `project_checkpoint` ✅
5. **Stops. Never creates a message. Never sets `summary=true`. Never creates a visible part.**

The body sits in `project_checkpoint` as raw infrastructure with no consumer. Not a message, not a part, invisible to user and UI. A database ghost.

**Database**: Session `ses_04bfeebdeffe9q21JpVaW5G0zM` has 1 valid sidecar body (2,106 chars, all 4 sections complete) in `project_checkpoint`. 0 visible summary anywhere.

---

## Trash 3: `maybeCompactCadence` blocks single-sidecar compaction

**File**: `compaction.ts:1343-1351`

```typescript
const openSidecars = IncrementalCheckpoint.listOpen(sessionID).length
if (openSidecars === 1) {
  return false  // ← refuses to compact with exactly 1 sidecar
}
```

With 1 open sidecar, compaction refuses. The body rots forever because:
- Layer-1 sidecar fires at ~65K content tokens
- Most sessions end before ~130K (second sidecar window)
- Result: compaction never triggers, body never materialized, user never sees summary

Even user-initiated POST `/summarize` calls `compact.compact({force: true})` — but `force` bypasses the idempotency guard (line 705) not the `openSidecars===1` guard.

**Database**: 162 messages, 1 open sidecar, 0 compacted.

---

## Trash 4: Plan mode cannot write to `plans/`

**File**: N/A — system constraint

The project convention says plans go in `plans/`, completed plans in `plans_completed/`. The kernel instructs: *"Final Plan — write to `plans/`"*.

But the plan mode constraint says: *"STRICTLY FORBIDDEN from ANY file edit, modification, or system change. Do NOT use write tool."*

The `write` tool is disabled in plan mode. There is no exception for `plans/`. The plan mode instructions tell you to write a plan but simultaneously block every mechanism for doing so.

To write this report, I had to wait for the user to switch to build mode. The `plans/` convention is unreachable from plan mode.

---

## Bonus Trash: Unused schemas and tables

| Artifact | Location | State |
|----------|----------|-------|
| `CompactionPart` type | `message-v2.ts:229-239` | 0 instances in 54,667 parts |
| `session_entry.compaction` | `session_entry` table | 0 rows across 115 sessions |
| `injectSummaryRequest` export | `compaction.ts:1007` | Only consumed by test file |

---

## Database Evidence

### `D:\zPython\!!!\.opencode\data\opencode.db` (1 session, 162 messages)

```
project_checkpoint rows:      1 (open, 2,106 chars valid body)
summary=true messages:        0
compacted messages:           0
CompactionPart instances:     0
messageStar parts:            0
summary-range markers:        0
session diffs tracked:        1,472 additions
```

### `D:\zPython\opencode\.opencode\data\opencode.db` (114 sessions, 11,703 messages)

```
project_checkpoint rows:      15 (5 materialized, 10 open)
summary=true messages:        32 (all pre-Jul-29 legacy)
compacted messages:           6,648 (57%)
CompactionPart instances:     0
session_entry compaction:     0 rows
```

---

## Net Effect

```
maybeCaptureSidecar() → writes body → project_checkpoint (invisible)
maybeCompactCadence() → openSidecars===1 → return false (blocked)
injectSummaryRequest() → no caller → never runs (dead)

RESULT: Sidecar bodies trapped in DB. Zero visible summaries.
```

---

## Smoke Tests

- [x] `injectSummaryRequest` has 0 production callers
- [x] `D:\zPython\!!!\` session: sidecar body exists, 0 `summary=true` messages
- [x] `CompactionPart` count = 0 across all databases
- [x] `session_entry` compaction count = 0
- [x] `write` tool blocked in plan mode — `plans/` convention unreachable
