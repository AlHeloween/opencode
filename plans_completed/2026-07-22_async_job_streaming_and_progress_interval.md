# Async Job Streaming & Progress Interval — Interactive Background Jobs

**Date**: 2026-07-22
**Status**: ✅ Completed
**Predecessor**: `2026-07-20_background_jobs_streaming_fix.md` (plan written, bash/cmd implementation never landed)

## Problem

Background jobs (`bash`, `cmd` tools with `run_in_background: true`) had two critical gaps:

### Gap 1: No incremental output streaming (bash, cmd)

The July 20 plan described piping `writeOutput` through `onOutput` in `bash.ts` and `cmd.ts`, but the code never received these changes. The `_writeOutput` parameter was accepted but **ignored** (underscore prefix = intentionally unused). Only `run.ts` had proper streaming.

**Symptom**: `job_output` showed `[started] Description...` with no incremental output until the command finished. For long-running commands (compiles, deploys), the model saw zero progress.

```typescript
// bash.ts:871 — BROKEN (pre-fix)
run: (_writeOutput) => Effect.gen(function* () {
    const result = yield* run({...}, ctx)
    return result.output  // ← only final result, no streaming
}),
```

### Gap 2: `job_wait` blocks blindly — no intermediate control

`job_wait` blocked until all jobs completed or timeout fired. The model had zero agency during the wait — couldn't check progress, couldn't kill a stuck job, couldn't respond to the user. For a 4-hour kernel compilation, this is unusable.

**Symptom**: Model calls `job_wait` → frozen for 30+ seconds → timeout → model finally sees output. No way to inspect or interrupt mid-flight.

## Root Cause Analysis

### Gap 1: Bash/Cmd `run()` lacked `onOutput` hook

| Tool | `onOutput` param in `run()` | Background passes `writeOutput`? | Streams incrementally? |
|------|:---:|:---:|:---:|
| **run.ts** | ✅ line 139 | ✅ line 305 (3rd arg) | ✅ Working since July 20 |
| **bash.ts** | ❌ missing | ❌ `_writeOutput` ignored | ❌ **Broken** |
| **cmd.ts** | ❌ missing | ❌ `_writeOutput` ignored | ❌ **Broken** |
| **task.ts** | N/A | ❌ `_writeOutput` (intentional) | ❌ Sub-agent returns atomically |

The `writeOutput` callback provided by `Jobs.startEffect` is the sole mechanism for streaming output from a background job. It updates `j.lastOutputAt` (resets stall timer), appends to `j.output` (visible via `job_output`), and publishes `JobsUpdated` events (TUI sidebar). Without calling it, the job's output buffer stays at `[started] Description...` until the effect completes.

### Gap 2: `job_wait` had no intermediate return mechanism

The polling loop only had two exit conditions: all jobs terminal, or timeout. No way to return control to the model periodically while jobs are still running. The model's only choices were:
- `job_wait` (block blindly)
- `job_output` (manual polling — model rarely does this unprompted)
- End turn (job completion injected next turn via `drainCompletedNote`)

## Changes

### Phase 1: Streaming fix — bash.ts + cmd.ts

**`bash.ts`:**
- `run()` input type: added `onOutput?: (chunk: string) => void` (line 627)
- `onChunk` handler: added `input.onOutput?.(chunk)` call (line 675)
- Background wrapper: `_writeOutput` → `writeOutput`, passed as `onOutput: writeOutput` (line 882)

**`cmd.ts`:**
- `run()` input type: added `onOutput?: (chunk: string) => void` (line 408)
- `onChunk` handler: added `input.onOutput?.(chunk)` call (line 443)
- Background wrapper: `_writeOutput` → `writeOutput`, passed as `onOutput: writeOutput` (line 569)

**Result**: Every stdout/stderr chunk now flows through `writeOutput` → `job_output` in real-time. The July 20 plan is now fully implemented.

### Phase 2: `progress_interval_ms` — interactive `job_wait`

**`job_output.ts` — `JobWaitParameters`:**
- New optional parameter: `progress_interval_ms: number`
- When set, `job_wait` returns every N milliseconds with intermediate status instead of blocking until completion
- Return format includes elapsed time and a `[progress tick...]` suffix when jobs are still running

**Behavior matrix:**

| Scenario | Behavior |
|----------|----------|
| No `progress_interval_ms` | Unchanged — blocks until all jobs finish or timeout |
| `progress_interval_ms=60000` | Returns every 60s with status + output, model decides next action |
| `progress_interval > timeout` | Timeout fires first, interval not reached |
| All jobs done before interval | Immediate return, no `[progress tick...]` suffix |
| Mixed done+running | Combined output: done jobs show final status, running show elapsed |

**Model interaction loop with progress_interval:**
```
1. Model: bash "make -j$(nproc)" → job bash-1 started
2. Model: job_wait(job_ids: ["bash-1"], progress_interval_ms: 60000)
3. [60s later] → "bash-1 (running, 60s elapsed): CC kernel/sched.o ..."
   [progress tick — jobs still running. Call job_wait again to continue waiting, or job_kill to abort.]
4. Model decides: "Compilation progressing normally. Continue."
5. Model: job_wait(job_ids: ["bash-1"], progress_interval_ms: 60000)
6. [60s later] → same pattern, model checks progress...
7. ...repeats for 4 hours (240 cycles) until compilation completes
```

This is **not a timeout** — the model makes a conscious decision at each interval whether to continue, kill, or pivot. For a 4-hour kernel build, the model executes 240 decision cycles instead of one blind wait.

## Edge Cases Verified

### `progress_interval_ms = 0`
Instant return — useful for "check status without blocking." The condition `Date.now() - intervalStart >= 0` is immediately true.

### `progress_interval_ms > timeout`
Timeout check (`Date.now() - start < maxWait`) runs first in the while loop. If timeout=30s and interval=120s, timeout fires at 30s before interval is reached.

### Multiple jobs, mixed states
Each job is individually queried via `jobs.output()`. Done jobs show final status; running/stalled jobs show elapsed time and current output. The `stillRunning` flag gates the `[progress tick...]` suffix.

### Backward compatibility
Without `progress_interval_ms`, behavior is byte-for-byte identical to the pre-change implementation. The parameter is fully optional.

## Files Changed (3 files, +24/-8)

| File | Changes |
|------|---------|
| `packages/opencode/src/tool/bash.ts` | +3/-1 — `onOutput` param, `onChunk` call, background passthrough |
| `packages/opencode/src/tool/cmd.ts` | +3/-2 — `onOutput` param, `onChunk` call, background passthrough |
| `packages/opencode/src/tool/job_output.ts` | +18/-5 — `progress_interval_ms` param, interval return logic, elapsed formatting |

## Verification

- **Typecheck**: `tsgo --noEmit` — ✅ clean (0 errors)
- **Job-workflow tests**: 3/3 pass (41.78s)
  - ✓ full lifecycle: bash → job_output → job_wait → done
  - ✓ stalled → job_kill flow
  - ✓ job_kill no-op on already-done job
- **CodeGraph impact analysis**: No unexpected callers of modified functions
- **ADM RAG**: Confirmed July 20 plan was written but never landed for bash/cmd

## What's Not Covered (Future Work)

### task.ts — sub-agent progress visibility

`task.ts` intentionally ignores `writeOutput` (`_writeOutput` prefix) because `ops.prompt()` returns sub-agent results atomically — there's no token-by-token streaming API exposed. The final result surfaces via `startEffect` fallback (jobs/index.ts lines 474-475): if `writeOutput` was never called, the return value replaces `[started]`.

**Gap**: For long-running sub-agents (30s+), `job_output` shows only `[started] Task...` until completion. Fixing this requires either:
1. Token-level callbacks from `ops.prompt()` passed to `writeOutput`
2. Polling partial results from the sub-agent session

This is a feature enhancement, not a bug — the current code works correctly.

### Heartbeat/progress callback for silent jobs

Jobs that produce no output for extended periods (e.g., waiting for network, slow computation with no stdout) correctly transition to `stalled` after 15s. But there's no mechanism for the job to proactively say "I'm alive, just waiting." A `heartbeat` callback in `startEffect` could solve this — the job calls it periodically to reset the stall timer even without output bytes. Not implemented yet.
