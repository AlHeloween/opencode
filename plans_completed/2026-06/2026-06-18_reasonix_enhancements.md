# Implementation Plan: Reasonix-Inspired Enhancements

**Created**: 2026-06-18
**Purpose**: Adopt the 3 remaining advantages from DeepSeek-Reasonix, ordered by priority.

## Status (2026-06-19)

- **Goal 1 (Tool Preview)**: Implemented via different architecture — diffs computed inline during tool execution, rendered in TUI permission prompt. No separate `preview()` method.
- **Goal 2 (Multi-Tier Compaction)**: ✅ Tasks 2.1-2.4 complete. Task 2.5 (TUI toast) ✅ complete.
- **Goal 3 (Background Jobs)**: ✅ Tasks 3.2, 3.3, 3.5-3.9 complete. Task 3.1 (SQLite persistence) ✅ complete via separate `jobs.db`. Task 3.4 (task tool background) ✅ complete.

---

## Goal 1: Tool Preview Interface (HIGH)

**Abstract**: Add pre-execution diff preview to writer tools. Before `edit`, `write`, `multiedit`, and `apply_patch` execute, compute the change, render a unified diff, and show it in the permission approval card so the user sees what will change before approving.

### Task 1.1: Add `preview()` to tool interface

**File**: `packages/opencode/src/tool/tool.ts`

Add optional `preview` method to the tool execute result:

```typescript
// Optional preview capability: given the same params execute receives,
// compute the file change that WOULD be made without touching disk.
// Returns a diff string and metadata (added/removed lines).
export interface PreviewResult {
  diff: string          // unified diff
  added: number         // lines added
  removed: number       // lines removed
  filePath: string      // affected file
  binary: boolean       // true if binary (diff would be noise)
}
```

### Task 1.2: Implement preview for each writer tool

| Tool | How | File |
|------|-----|------|
| `edit` | Run 9-strategy replacer against in-memory content, build diff from old/new | `tool/edit.ts` |
| `write` | If file exists, read current content, diff old→new. If new file, report "create". | `tool/write.ts` |
| `multiedit` | Replay all edits against in-memory buffer, build cumulative diff | `tool/multiedit.ts` |
| `apply_patch` | Parse patch, compute per-file changes, build per-file diffs | `tool/apply_patch.ts` |

Each tool's `execute()` gains a `preview()` step that runs FIRST (before any file modifications), computes the diff, and returns it as metadata alongside the tool result.

### Task 1.3: Integrate preview into permission flow

**File**: `packages/opencode/src/agent/agent.ts` (or permission call site)

In `executeOne` or the tool execution path, BEFORE executing the writer tool:
1. Call `tool.preview(args)` if the tool supports it
2. Attach the `PreviewResult` to the tool dispatch event
3. The permission prompt renders the diff inline

### Task 1.4: Render diff in TUI permission prompt

**File**: `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx`

When a writer tool requests permission and has a preview:
- Show a "+N / -M" summary line
- Show folded unified diff (first 40 lines, "+N more" footer)
- Color: green for additions, red for deletions (reuse theme colors)

### Task 1.5: Add preview to permission events (SDK)

**File**: `packages/opencode/src/bus/bus-event.ts`

Extend the `Event.Asked` schema to include optional `preview?: PreviewResult` so the web app and future frontends can render diffs too.

---

## Goal 2: Multi-Tier Compaction (MEDIUM)

**Abstract**: Add soft/full/force threshold tiers to our compaction trigger. Add stuck detection. Improve summary template with explicit "Commands & outcomes" and "Errors & fixes" sections.

Our compaction loop is already strong (real tokenizers, content-based overflow, anchored summaries). These are targeted improvements.

### Task 2.1: Add multi-tier thresholds

**File**: `packages/opencode/src/session/overflow.ts`

Add three threshold levels:

```typescript
export function compactionTier(input: { cfg, tokens, model }): "none" | "soft" | "full" | "force" {
  if (input.cfg.compaction?.auto === false) return "none"
  if (input.model.limit.context === 0) return "none"
  
  const used = tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
  const window = input.model.limit.context
  const ratio = used / window
  
  const soft = input.cfg.compaction?.soft_ratio ?? 0.5   // 50%
  const full = input.cfg.compaction?.full_ratio ?? 0.8    // 80%
  const force = input.cfg.compaction?.force_ratio ?? 0.9  // 90%
  
  if (ratio >= force) return "force"
  if (ratio >= full) return "full"
  if (ratio >= soft) return "soft"
  return "none"
}
```

| Tier | Default | Behavior |
|------|---------|----------|
| `none` | < 50% | No action |
| `soft` | ≥ 50% | Emit `Event.CompactionNotice` (info event, one-shot per approach) |
| `full` | ≥ 80% | Trigger compaction (current behavior) |
| `force` | ≥ 90% | Trigger compaction, bypass economics check |

### Task 2.2: Add stuck detection

**File**: `packages/opencode/src/session/compaction.ts`

Add a `consecutiveCompacts` counter. If compaction fires on 2+ consecutive turns and the context is still above the trigger threshold, emit a warning and pause auto-compaction:

```typescript
const MAX_CONSECUTIVE = 3
let consecutiveCompacts = 0
let compactionPaused = false

// After each compaction:
if (tokens.stillAboveThreshold) {
  consecutiveCompacts++
  if (consecutiveCompacts >= MAX_CONSECUTIVE) {
    compactionPaused = true
    log.warn("bug: compaction stuck — context window too small")  
    yield* bus.publish(Event.CompactionStuck, { sessionID })
  }
} else {
  consecutiveCompacts = 0
  compactionPaused = false
}
```

### Task 2.3: Improve summary template

**File**: `packages/opencode/src/session/compaction.ts`

Add two new sections to the `SUMMARY_TEMPLATE`:

```
## Commands & Outcomes
- [commands run and their results, or "(none)"]

## Errors & Fixes
- [problems encountered and resolutions, or "(none)"]
```

Insert between `Progress` and `Key Decisions`. Remove or merge redundant sections if the template gets too long.

### Task 2.4: CompactStuck event

**File**: `packages/opencode/src/session/compaction.ts`

Add to the existing `Event` namespace:

```typescript
CompactionStuck: BusEvent.define(
  "session.compaction.stuck",
  Schema.Struct({ sessionID: SessionID }),
),
```

### Task 2.5: TUI notice for soft threshold

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx`

Listen for `Event.CompactionNotice` and show a brief toast: "Context at 50% — compaction will trigger at 80%."

---

## Goal 3: Background Job Manager (LOWER)

**Abstract**: Replace `Effect.forkIn(scope)` with a persistent job system. Jobs survive across turns, stream output incrementally, report completion in subsequent turns, and persist to SQLite. Solves the `cmd_runner` workaround for long-running bash commands.

### Task 3.1: Add `job` SQLite table

**File**: `packages/opencode/src/session/session.sql.ts`

```typescript
export const JobTable = sqliteTable("job", {
  id: text().primaryKey(),          // "bash-1", "task-2"
  session_id: text().notNull(),
  kind: text().notNull(),           // "bash" | "task"
  label: text().notNull(),
  status: text().notNull(),         // "running" | "done" | "failed" | "killed"
  output: text().default(""),       // accumulated output
  result: text(),                   // final answer (task jobs)
  created_at: integer().notNull(),
  finished_at: integer(),
})
```

### Task 3.2: Create `JobManager` Effect service

**File**: `packages/opencode/src/jobs/index.ts` (new)

```typescript
export interface Interface {
  readonly start: (input: {
    sessionID: SessionID
    kind: "bash" | "task"
    label: string
    run: (ctx: JobContext) => Effect.Effect<string, Error>
  }) => Effect.Effect<JobID>
  
  readonly output: (jobID: JobID) => Effect.Effect<string>
  readonly kill: (jobID: JobID) => Effect.Effect<boolean>
  readonly drain: (sessionID: SessionID) => Effect.Effect<string>  // completion notes
  readonly list: (sessionID: SessionID) => Effect.Effect<JobInfo[]>
}
```

### Task 3.3: Integrate with `bash` tool

**File**: `packages/opencode/src/tool/bash.ts`

When the `bash` tool has a `run_in_background` flag:
1. Call `JobManager.start({ kind: "bash", label, run: spawnCmd })`
2. Return immediately with job ID
3. The command runs in a forked Effect fiber with output streaming to the job's buffer
4. On completion, queue a completion note for the next turn

### Task 3.4: Integrate with `task` tool

**File**: `packages/opencode/src/tool/task.ts`

When the `task` tool spawns a sub-agent in background:
1. Call `JobManager.start({ kind: "task", label, run: agentLoop })`
2. The sub-agent runs in its own session
3. Final answer is stored as `result`
4. Completion note queued

### Task 3.5: Inject completion notes into next turn

**File**: `packages/opencode/src/session/prompt.ts`

Before building the system prompt for the next turn:
1. Call `JobManager.drain(sessionID)` to get completion notes
2. If non-empty, prepend a `<background-jobs>` block to the user's message:

```
<background-jobs>
Background jobs since your last turn: bash-1 → done (npm install completed), task-2 → failed (timeout).
Use session-read with the job ID to read full output, or wait if still needed.
</background-jobs>
```

### Task 3.6: Add `wait` and `bash_output` tools

**File**: `packages/opencode/src/tool/job_output.ts` (new)

Two small tools for the model to interact with background jobs:
- `job_output(job_id)` — reads incremental output from a running/completed job
- `job_wait(job_ids)` — blocks until specified jobs reach terminal state, returns results

---

## Execution Order

1. **Phase A**: Goal 1 (Tool Preview) — Tasks 1.1-1.5
2. **Phase B**: Goal 2 (Multi-Tier Compaction) — Tasks 2.1-2.5
3. **Phase C**: Goal 3 (Background Jobs) — Tasks 3.1-3.6
4. **Phase D**: Tests, verification, commit

---

## Oracle Verification

- `bun typecheck` — passes in all phases
- Tool preview: `edit` tool produces diff in permission prompt
- Compaction: soft notice appears at 50%, stuck detection fires after 3 consecutive compactions
- Background jobs: `bash run_in_background` survives turn boundary, output retrievable via `job_output`

---

## Files Summary

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1 — Preview | 0 | `tool/tool.ts`, `tool/edit.ts`, `tool/write.ts`, `tool/multiedit.ts`, `tool/apply_patch.ts`, `cli/cmd/tui/routes/session/permission.tsx`, `agent/agent.ts`, `bus/bus-event.ts` |
| 2 — Compaction | 0 | `session/overflow.ts`, `session/compaction.ts`, `cli/cmd/tui/app.tsx` |
| 3 — Jobs | 3 (`jobs/index.ts`, `tool/job_output.ts`, migration) | `session/session.sql.ts`, `tool/bash.ts`, `tool/task.ts`, `session/prompt.ts` |
