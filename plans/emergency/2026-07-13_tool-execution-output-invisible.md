# Tool Execution Output Invisibility & Silent Failures

## Objective

Fix three interlocking bugs: (1) shell commands block without releasing until completion — including cmd_runner which spawns its own terminal and never exits, (2) `run` tool output is invisible in TUI during execution, (3) multiple silent failure paths make errors unassessable by the user.

## Root Cause Analysis

### R1a: `run.ts` has no timeout or abort

**File:** `packages/opencode/src/tool/run.ts:189, 239`

`bash.ts` uses `Effect.raceAll([handle.exitCode, abort, timeout])` (line 720). `run.ts` only uses `yield* handle.exitCode` (line 189) — **blocks indefinitely**. The `timeout` parameter is computed at line 239 but never passed to execution. No abort signal handling. A hung binary hangs the entire turn forever.

### R1b: `cmd_runner` spawns own terminal, never exits

**File:** `packages/opencode/src/tool/bash.ts:859-888`, `packages/opencode/src/tool/cmd.ts:570-593`

`cmd_runner.exe` spawns its **own terminal window** for interactive debug — that's its design purpose. The user's command runs in that window and completes, but the `cmd_runner` process itself stays alive as a persistent daemon (waiting for further `send` commands). opencode's tool execution waits for process exit — which never happens. The tool hangs forever while the actual work is already done.

**Observed:** `adm --clean --all` launched via bash → cmd_runner spawned terminal → adm ran and completed in terminal → cmd_runner process still alive → opencode tool blocked indefinitely.

**Fix:** Detect `cmd_runner` in the command string. When `run_in_background` is already set (which it is for cmd_runner invocations), don't wait for process exit — return immediately with the job ID. The existing background job mechanism already handles this: `job_output` reads incremental output, `drainCompletedNote` notifies on completion. The bug is that even with `run_in_background: true`, the code at `bash.ts:720` still does `Effect.raceAll` on `handle.exitCode`.

### R2: Tool output is completion-only; no streaming to TUI

**File:** `packages/opencode/src/session/message-v2.ts:305-376`, `packages/opencode/src/session/processor.ts:277-304`

The `ToolStateCompleted` schema requires `output: Schema.String` — only set atomically at completion. `ToolStateRunning` has no `output` field. Unlike text/reasoning which use `updatePartDelta()` for incremental streaming, tool output has **no delta mechanism**. The TUI correctly shows nothing because nothing exists in the data model.

**Impact:** User sees a spinner for the entire duration. If the tool errors or the output exceeds limits, the user gets no feedback at all.

### R3: Multiple silent failure paths

| File:Line | Failure | Consequence |
|-----------|---------|-------------|
| `bash.ts:494-499` | `cygpath` errors caught, replaced with `[]`, no log | Path resolution silently fails |
| `bash.ts:665-670` / `run.ts:161-166` | Rolling buffer drops oldest output when >2× maxBytes | Output permanently lost before spill to temp file |
| `bash.ts:738` | `Effect.orDie` converts scoped errors to defects | Process spawn failures become unhandled defects |
| `run.ts:204` | Sink error handler swallows error with no log | Disk-full/permission errors invisible |
| `jobs/index.ts:296-297` | Unknown job returns `{text:"", status:"failed"}` silently | No diagnostic for misaddressed job |
| `jobs/index.ts:375` | Semaphore blocks tool call start indefinitely | If 2 jobs running, 3rd tool call hangs with no feedback |

---

## Fix Plan

### Phase 1: `run.ts` timeout + abort (P0-CRITICAL)

**File:** `packages/opencode/src/tool/run.ts`

Add the same `Effect.raceAll([handle.exitCode, abort, timeout])` pattern that `bash.ts` uses:

```typescript
// Replace line 189: yield* handle.exitCode
// With:
const env = yield* Environment.Service
const abort = Effect.sync(() => ctx.abort.aborted ? -1 : undefined).pipe(
  Effect.filterOrFail((c) => c === undefined),
  Effect.zipRight(Effect.never),
  Effect.raceEither(Effect.promise(() => {
    let done: () => void
    const promise = new Promise<{ _tag: "abort" }>((r) => { done = () => r({ _tag: "abort" as const }) })
    ctx.abort.addEventListener("abort", done)
    return promise
  })),
)
const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT
const timeout = Effect.sleep(`${timeoutMs + 100} millis`).pipe(
  Effect.as({ _tag: "timeout" as const })
)

const exit = yield* Effect.raceAll([handle.exitCode.pipe(Effect.map((c) => ({ _tag: "exit" as const, code: c }))), abort, timeout])
if (exit._tag !== "exit") {
  yield* handle.kill({ forceKillAfter: "3 seconds" })
}

// Also fix: pass timeout into run()
if (exit._tag === "timeout") {
  expired = true
  log.warn("run tool timed out", { command: input.binary, timeout: timeoutMs })
}
```

### Phase 2: Tool output delta streaming (P0-CRITICAL)

**Three files affected:**

#### 2a. Schema: Add `output` to `ToolStateRunning`

**File:** `packages/opencode/src/session/message-v2.ts`

```typescript
// ToolStateRunning currently: { status: "running", input, title?, metadata?, time }
// Add optional output field:
const ToolStateRunning = Schema.Struct({
  status: Schema.Literal("running"),
  input: Schema.Unknown,
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  output: Schema.optional(Schema.String),  // ← NEW: incremental output
  time: ToolStateTime,
})
```

#### 2b. Processor: Stream tool output via `updatePartDelta`

**File:** `packages/opencode/src/session/processor.ts`

Add a `tool-output-delta` event type. When `ctx.metadata()` is called with `{ output: chunk }`, emit a delta:

```typescript
// In tools.ts ctx.metadata(), accept output chunks:
output: (val: string) => {
  input.processor.publishDelta({
    type: "tool-output-delta",
    toolCallId: options.toolCallId,
    delta: val,
  })
}
```

The processor handles `tool-output-delta` the same way as `text-delta`:
```typescript
case "tool-output-delta": {
  yield* session.updatePartDelta({ messageID, partID, kind: "tool", field: "output", delta: msg.delta })
}
```

#### 2c. Tools: Call `ctx.output()` during execution

**File:** `packages/opencode/src/tool/bash.ts`, `run.ts`, `cmd.ts`

In the `Stream.runForEach` callback, call `ctx.output(chunk)` alongside the existing buffer logic:

```typescript
Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
  // Existing: buffer management
  list.push(chunk)
  used += byteLength(chunk)
  // ... rolling buffer logic ...
  
  // NEW: stream to TUI
  ctx.output(chunk)
  
  // Existing: metadata update
  ctx.metadata({ title: ..., metadata: ... })
})
```

### Phase 3: Fix silent failure paths (P1-HIGH)

#### 3a. `bash.ts`: Log cygpath failures

**File:** `packages/opencode/src/tool/bash.ts:494-499`

```typescript
// Replace: .pipe(Effect.catch(() => Effect.succeed([])))
// With:
.pipe(Effect.catch((e) => {
  log.debug("cygpath failed, using original paths", { error: String(e) })
  return Effect.succeed([] as string[])
}))
```

#### 3b. `bash.ts`: Replace `orDie` with structured error

**File:** `packages/opencode/src/tool/bash.ts:738`

```typescript
// Replace: ).pipe(Effect.orDie)
// With:
).pipe(Effect.catchAll((e) => Effect.fail(new BashError({ cause: e }))))
```

#### 3c. `run.ts`: Log sink errors

**File:** `packages/opencode/src/tool/run.ts:204`

```typescript
// Replace: sink?.on("error", () => done())
// With:
sink?.on("error", (e) => {
  log.debug("run output sink error", { error: String(e) })
  done()
})
```

#### 3d. `jobs/index.ts`: Log unknown job access

**File:** `packages/opencode/src/jobs/index.ts:296-297`

```typescript
// Before: if (!j) return { text: "", status: "failed" }
// After:
if (!j) {
  log.debug("job_output called for unknown job", { sessionID, jobID: input.jobID })
  return { text: "", status: "failed" }
}
```

#### 3e. `bash.ts` / `run.ts`: Write full output to temp file from start

**File:** `packages/opencode/src/tool/bash.ts:665-670`, `packages/opencode/src/tool/run.ts:161-166`

Instead of a rolling buffer that drops old output, open the temp file write stream immediately and write ALL chunks to it. Keep the in-memory buffer for the last N bytes for the final output but guarantee the full output is on disk.

### Phase 4: TUI progress indication (P2-MEDIUM)

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:2058-2125`

When `output` exists on a running tool part (after schema change), show it in real-time:

```tsx
// In InlineTool / BlockTool:
<Show when={props.part.state.status === "running" && props.part.state.output}>
  <Text dim>{lastLines(props.part.state.output, 5)}</Text>
</Show>
```

---

## Execution Order

1. Phase 1: `run.ts` timeout + abort (unblock hung turns)
2. Phase 2a: Schema change — add `output` to `ToolStateRunning`
3. Phase 2b: Processor — `tool-output-delta` event + `updatePartDelta`
4. Phase 2c: Tools — call `ctx.output(chunk)` in streaming callbacks
5. Phase 3a-e: Silent failure path fixes (5 files)
6. Phase 4: TUI real-time output display

## Acceptance Tests

```bash
# 1. run tool with a long-running command shows incremental output
#    Example: run({ binary: "node", args: ["-e", "for(let i=0;i<5;i++){console.log(i); await new Promise(r=>setTimeout(r,1000))}"] })
#    Expected: TUI shows each number as it's printed, not just a spinner for 5 seconds

# 2. run tool with timeout actually times out
#    Example: run({ binary: "node", args: ["-e", "setTimeout(()=>{}, 999999)"], timeout: 2000 })
#    Expected: Tool completes with timeout error after ~2 seconds

# 3. Silent failure paths produce log entries
#    Check logs for: "cygpath failed", "run output sink error", "job_output called for unknown job"

# 4. bash tool output streams to TUI during execution
#    Example: bash({ command: "for i in 1 2 3 4 5; do echo $i; sleep 1; done" })
#    Expected: Numbers appear incrementally

# 5. Typecheck unchanged
bun typecheck  # packages/opencode — same diagnostic count
```
