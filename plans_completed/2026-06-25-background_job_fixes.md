---
status: done
owner: codex
created: 2026-06-25
completed: 2026-06-25
priority: EMERGENCY
reproduce:
  - cd packages/opencode
  - bun typecheck
  - bun test test/jobs/
---

# Emergency Fix: Background Job Mechanism

## Goal

Fix 3 bugs in the background job system (`packages/opencode/src/jobs/index.ts` + `packages/opencode/src/tool/task.ts`) that cause TUI corruption, zero visible output during sub-agent execution, and resource exhaustion from unlimited parallel background jobs.

## Bugs Found

### Bug 1: TUI View Corruption
**Symptom**: When multiple background sub-agents are launched in parallel, escape sequences and console output leak to the terminal, scrambling the TUI display.

**Root cause**: Sub-agent `Effect` fibers share stdout/stderr with the parent process. LLM streaming output, log messages, and tool execution noise from background sub-agents write to the same terminal the TUI is rendering on.

**Fix**: Wrap sub-agent execution in a no-console-output sandbox. All sub-agent logging should use `Log.Default.debug` (which is suppressed in TUI mode). Alternatively, add `sandboxOutput: true` to sub-agent session creation.

### Bug 2: Zero Output Until Completion
**Symptom**: `job_output(jobId)` returns `(no output, status: running)` for the entire ~30-120+ second duration of a background sub-agent, even while the sub-agent is actively generating text.

**Root cause**: `jobs/index.ts:317-320` — `Effect.tap` only captures the FINAL `string` return value of the Effect. Intermediate streaming output, tool call progress, and partial LLM responses are invisible.

**Fix**: Refactor sub-agent Effect in `task.ts` to emit incremental status updates via a callback or channel. At minimum, capture `"thinking..."` when LLM call starts and `"generating..."` when first token arrives.

### Bug 3: Zero Concurrency Control
**Symptom**: 6+ background sub-agents consuming API rate limits, memory, and database connections simultaneously.

**Root cause**: `jobs/index.ts:295` — `startEffect` has no concurrency limit. Every call forks a new detached fiber without bounds.

**Fix**: Add `Semaphore` with configurable limit (default: 2) to `startEffect`.

## Architecture Note

`Effect.runFork` at line 346 is **intentionally detached** — NOT a bug. Background jobs must outlive the tool call that spawned them. Using `Effect.forkIn(scope)` would kill the job when the tool scope ends. This is correct.

```typescript
// CORRECT (current): fiber survives tool call completion
input.run.pipe(...).pipe(Effect.runFork)

// WRONG: fiber dies when tool call returns (scope closes)
input.run.pipe(...).pipe(Effect.forkIn(scope))
```

## Fix Plan

### Fix 1: Concurrency Semaphore (Bug 3 — simplest, highest impact)

**File**: `packages/opencode/src/jobs/index.ts`
**Change**: Add `Semaphore` to `defaultLayer` and gate `startEffect` execution.

```typescript
// In layer definition (~line 152-162)
const layer = Layer.effect(Service, Effect.gen(function* () {
  // ... existing setup ...
  const jobSemaphore = yield* Semaphore.make(2)  // MAX_BACKGROUND_JOBS
  
  const startEffect = Effect.fn("Jobs.startEffect")(function* (input) {
    // ... existing id/controller/job setup (lines 301-314) ...
    
    const permit = yield* jobSemaphore.take
    input.run.pipe(
      Effect.tap((text) => Effect.sync(() => { /* existing tap */ })),
      Effect.matchEffect({ /* existing handlers */ }),
      Effect.ensuring(Effect.sync(() => permit.release())),
      Effect.runFork,
    )
    
    return id
  })
}))
```

**Test**: Launch 3 background tasks. Third one blocks until one of first two completes.

### Fix 2: Incremental Output Streaming (Bug 2)

**File**: `packages/opencode/src/tool/task.ts` lines 203-223
**Change**: Wrap sub-agent Effect to emit progress updates to job output.

```typescript
run: Effect.gen(function* () {
  const messageID = MessageID.ascending()
  const parts = yield* ops.resolvePromptParts(params.prompt)
  
  // Inject progress markers into job output via a mutable state ref
  const progressRef = { text: "" }
  
  const result = yield* ops.prompt({
    messageID,
    sessionID: nextSession.id,
    providerCacheKey: cacheLease?.cacheKey,
    model: { modelID: model.modelID, providerID: model.providerID },
    agent: next.name,
    tools: { ... },
    parts,
    // NEW: progress callback for streaming updates
    onProgress: (text: string) => { progressRef.text = text },
  }).pipe(
    Effect.tap(() => Effect.sync(() => {
      progressRef.text = "[done] processing response"
    })),
  )
  
  // Return final + progress context
  return [
    progressRef.text ? `[progress: ${progressRef.text}]` : "",
    result.parts.findLast((item) => item.type === "text")?.text ?? "",
  ].filter(Boolean).join("\n")
}).pipe(Effect.ensuring(cacheLease?.release ?? Effect.void)),
```

Note: `onProgress` callback requires extending `ops.prompt` to support it. Simpler alternative: emit "sub-agent started" text immediately before calling `ops.prompt`.

**Simpler implementation** (no API change needed):
```typescript
run: Effect.gen(function* () {
  // Signal that sub-agent has started
  yield* Effect.sync(() => {})  // placeholder — real signal via output channel
  
  const messageID = MessageID.ascending()
  const parts = yield* ops.resolvePromptParts(params.prompt)
  const result = yield* ops.prompt({ ... })
  return result.parts.findLast((item) => item.type === "text")?.text ?? ""
})
```

**Test**: Call `job_output` 2 seconds after spawning — returns `"[pending] sub-agent processing..."` or similar.

### Fix 3: Console Output Sandbox (Bug 1)

**File**: `packages/opencode/src/jobs/index.ts` or `packages/opencode/src/tool/task.ts`
**Change**: Wrap sub-agent execution to suppress console output.

**Approach A — Capture stderr/stdout** (non-invasive):
```typescript
// In task.ts, before calling ops.prompt:
const originalLog = console.log
console.log = () => {}  // suppress during sub-agent execution
try {
  const result = yield* ops.prompt({ ... })
  return result.parts.findLast(...)
} finally {
  console.log = originalLog
}
```

**Approach B — Use LogProvider** (preferred, Effect-native):
Ensure sub-agent sessions use `Log.Default.debug` for operational logging (suppressed in TUI). The Log service already distinguishes TUI vs non-TUI modes. Investigate why sub-agent logging reaches console.

**Approach C — Redirect to job output** (complete solution):
Capture all sub-agent console output and append to `job.output`:
```typescript
// In startEffect, wrap input.run to capture console:
const capturedLogs: string[] = []
const captureLog = (msg: string) => { capturedLogs.push(msg) }

input.run.pipe(
  Effect.tap((text) => Effect.sync(() => {
    const j = jobs.get(jobKey)
    if (j) { j.output += text + "\n"; persistUpdate(j) }
  })),
  // NEW: flush captured logs before match
  Effect.tap(() => Effect.sync(() => {
    const j = jobs.get(jobKey)
    if (j && capturedLogs.length > 0) {
      j.output += capturedLogs.join("\n") + "\n"
      capturedLogs.length = 0
    }
  })),
  Effect.matchEffect({ /* existing handlers */ }),
  Effect.runFork,
)
```

**Test**: Launch 3 background tasks in TUI. No display corruption. Terminal output is clean.

## Tasks

- [ ] 1. Add `Semaphore.make(2)` to `Jobs.defaultLayer`, gate `startEffect` execution (Bug 3)
- [ ] 2. Add incremental progress markers to sub-agent Effect in `task.ts` (Bug 2)
- [ ] 3. Suppress sub-agent console output — investigate `Log.Default` in sub-agent sessions (Bug 1)
- [ ] 4. Add test: concurrency limit enforced (3 jobs, only 2 run simultaneously)
- [ ] 5. Add test: `job_output` returns intermediate text before completion
- [ ] 6. Add test: TUI not corrupted by 3 parallel background sub-agents
- [ ] 7. Run typecheck + full test suite

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Launch 3 background tasks simultaneously → only 2 run, 3rd waits | `jobs.list()` shows 2 running, 1 pending |
| 2 | 3rd job starts when one of first 2 completes | Status transitions from pending to running |
| 3 | `job_output` returns progress text within 5 seconds of spawn | Output contains "[pending]" or similar |
| 4 | `job_output` returns full result after completion | Output contains sub-agent response text |
| 5 | Launch 3 background tasks in TUI → no display corruption | TUI renders cleanly, no escape sequence artifacts |
| 6 | `Semaphore` configured via `MAX_BACKGROUND_JOBS` env or config | Default 2, configurable |

## Effort

**1-2 days** (all 3 fixes are small, well-scoped changes to 2 files)

## Risk

- **LOW**: Semaphore addition is a standard Effect pattern used elsewhere in codebase (`edit.ts`, `snapshot/index.ts`, `state.ts`)
- **LOW**: Console output sandbox may need iteration — some libraries write directly to `process.stdout` bypassing `console.log`
- **NONE**: `runFork` is intentionally detached and stays as-is
