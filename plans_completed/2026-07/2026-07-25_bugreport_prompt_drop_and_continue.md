# Bug Report: Silent Prompt Drop, Auto-Continue, & logsearch Failure

**Date:** 2026-07-25  
**Session:** `ses_068cdd762ffePsPYHnHLBvKzft`  
**Model:** deepseek-v4-pro  
**Version:** 10.0.623

---

## Bug 1: User Prompt Silently Dropped (Single-Step Loop Exit)

### Observed behavior

User typed `"Let's think a bit, what we can do with this tool?"` at 13:06:59 UTC. The session processor ran exactly 1 step and exited the loop in 3 seconds (13:07:02). The model produced tool calls (task explorer + read) but no conversational response — the user saw the model auto-executing work rather than answering their question.

### Log evidence

From `log_system_ses_068cdd762ffePsPYHnHLBvKzft.jsonl`:

| Line | Timestamp | Event | Step |
|------|-----------|-------|------|
| 30 | 12:53:13.685 | `exiting loop` | 28 (previous work done) |
| 31 | 13:06:59.731 | `loop` | 0 (user prompt received) |
| 32 | 13:07:02.758 | `loop` | 1 (model step) |
| 33 | 13:07:02.763 | `exiting loop` | 1 (IMMEDIATE exit — 3s total) |

### Root cause

After compaction wiped conversation context, the injected `COMPACTION_REMINDER` (prompt.ts:319-321) said:

```
History was compacted. Active memory is the compacted block and/or summary
assistants (Inferred). Soft-hidden archive remains in the DB for tools
when you need a specific fact — do not recover wholesale; continue the task.
```

The last four words — **"continue the task"** — combined with the `PROMPT_BUILD` ALGORITHM_CARD spine (prompt.ts:352-364) that says **"Plan and implement here"** — caused the model to interpret the user's conversational question as a continuation of the prior coding task. Instead of answering "let's think about what we can do with this tool," the model launched sub-agent tasks to implement it.

The user's prompt was not *technically* dropped — it was processed — but the model's response was invisible tool-calling work, not a conversational answer. From the user's perspective, "nothing happened."

---

## Bug 2: Auto-Continue Without User Confirmation (28 Autonomous Steps)

### Observed behavior

The model auto-executed **28 sequential loop steps** across ~9 minutes (12:43:53 to 12:53:13) without any user input between steps. The user reports: "you started work without confirmation, all is fine job is done but looks continue command in wrong place."

### Log evidence

28 loop steps from `log_system_ses_068cdd762ffePsPYHnHLBvKzft.jsonl`:

| Step | Timestamp | Gap from previous |
|------|-----------|-------------------|
| 0 | 12:43:53.751 | — |
| 1 | 12:46:26.161 | +2m33s |
| 2 | 12:46:38.125 | +12s |
| 3 | 12:46:46.828 | +8s |
| ... | ... | ... |
| 28 | 12:53:13.682 | +11s |

Total: 28 autonomous steps over 9 minutes 20 seconds.

### Root cause — processor.ts:905-907

```typescript
// packages/opencode/src/session/processor.ts:905-907
if (ctx.needsCompaction) return "compact"
if (ctx.blocked || ctx.assistantMessage.error) return "stop"
return "continue"   // ← DEFAULT is auto-continue
```

The loop controller's default outcome is `"continue"` — the model auto-executes the next step unless:
- It needs compaction (treated as continue after compacting)
- It's blocked (permission required → stops and waits for user)
- An error occurred

There is no "task boundary" detection. The model doesn't check whether:
- The current task was completed
- A new user intent was expressed
- The user expected confirmation before proceeding

### Contributing factors

1. **COMPACTION_REMINDER** (prompt.ts:319-321): injects "continue the task" after every compaction — this persists across compaction cycles even when a new user message arrives
2. **PROMPT_BUILD spine** (prompt.ts:352-364): injects ALGORITHM_CARD with "Plan and implement here" — an imperative that drives autonomous execution
3. **KV-CACHE design constraint** (prompt.ts:337-338): "Never put [build mode text] in system/agent.prompt — same model switches plan↔build in one session; system prefix must stay byte-stable for KV cache." This forces build mode directives onto the conversation tail, where they mingle with user messages and compaction reminders

### How it cascades

```
Compaction wipes context
  → COMPACTION_REMINDER injected: "continue the task"
    → PROMPT_BUILD injected: "Plan and implement here"
      → New user message arrives
        → Model sees "continue" + "implement" in context
          → Auto-executes without conversational response
            → processor.ts returns "continue" (default)
              → Loops again... 28 times until task completes
```

---

## Bug 3: `logsearch` Tool Fails — `rg` Exit Code -1 (Bun.spawn API Misuse)

### Observed behavior

The `logsearch` tool (`packages/opencode/src/tool/logsearch.ts`) reports:

```
rg failed (exit -1): unknown error
```

ripgrep IS installed and works correctly (`rg --version` → 15.1.0). The failure is not a missing binary — it's a Bun.spawn API misuse.

### Root cause — logsearch.ts:107

```typescript
// packages/opencode/src/tool/logsearch.ts:96-109
const proc = Bun.spawn(["rg", ...rgArgs], {
  stdout: "pipe",
  stderr: "pipe",
  signal,
})

const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
])
const exitCode = await proc.exitCode  // ← BUG: exitCode is null, not a Promise

return { stdout, stderr, exitCode: exitCode ?? -1 }  // null → -1
```

### Bun.spawn API reality

Verified at runtime:
```
typeof proc.exitCode → "object"
exitCode value      → null        (before process exits)
typeof proc.exited  → "object"   (this IS a Promise<number>)
await proc.exited   → 0          (actual exit code)
exitCode after      → 0          (populated after exit)
```

In Bun, `proc.exitCode` is `number | null` — it's a **synchronous getter** that returns `null` while the process is running, then the actual exit code after the process exits. It is **NOT a Promise**. `await null` resolves immediately to `null`, which is then coalesced to `-1`.

The correct API is `proc.exited` → `Promise<number>`, which resolves when the process exits with the actual exit code.

### Why it was never caught

The code's error check (`exitCode !== 0 && exitCode !== 1 && exitCode !== 2`) catches "unexpected" exit codes. Since this tool is rarely invoked (only for debugging), and many systems have rg installed and the race condition sometimes results in exitCode being populated before the await (when process exits before streams are read), the bug went unnoticed.

### Additional issue: no stderr capture

Even when the bug is fixed, the error message on line 116:

```typescript
output: `rg failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "unknown error"}`,
```

Uses `result.stderr` which was already consumed by `new Response(proc.stderr).text()` earlier. But on the error path, `stderr` is read AFTER stdout — if the process crashed before writing to stdout, stderr might also be unavailable. The error path should capture both stdout and stderr as they arrive.

---

## Summary

| # | Bug | Severity | Symptom | Root Cause |
|---|-----|----------|---------|------------|
| 1 | Silent prompt drop | **High** | User question produces tool calls, not answer | COMPACTION_REMINDER "continue the task" + PROMPT_BUILD "Plan and implement" override conversational intent |
| 2 | Auto-continue without confirmation | **Medium** | 28 autonomous steps in 9 minutes | processor.ts default is `return "continue"` — no task-boundary or confirmation-gate logic |
| 3 | logsearch rg failure | **Low** | `rg failed (exit -1)` opaque error | `await proc.exitCode` (synchronous null) instead of `await proc.exited` (Promise) |

---

## Recommended Fixes

### Fix 1 & 2: Prompt drop & auto-continue

**Option A — Gate after compaction (minimal):** After compaction injects the reminder, add a flag or message trait that signals "user confirmation needed" for the next loop iteration. The processor checks this flag and returns `"stop"` instead of `"continue"` after the first non-compaction step following a compaction.

**Option B — Remove "continue the task" from reminder (targeted):** Change `COMPACTION_REMINDER` from "continue the task" to "the task may have changed — ground on current user intent." This preserves the informational purpose without the imperative.

**Option C — Add task-completion detection (structural):** After any `todowrite` with all tasks `completed`, or after any plan-exit, set a flag that forces `"stop"` on the next loop iteration. This prevents auto-chaining across task boundaries.

### Fix 3: logsearch

```typescript
// BEFORE (broken):
const exitCode = await proc.exitCode
return { stdout, stderr, exitCode: exitCode ?? -1 }

// AFTER (fixed):
const exitCode = await proc.exited  // ← Promise<number>, resolves with actual exit code
return { stdout, stderr, exitCode }
```

Also add a pre-flight check:
```typescript
// Before spawning:
const rgPath = Bun.which("rg")
if (!rgPath) {
  return {
    title: "LogSearch",
    metadata: { pattern: params.pattern, results: 0, error: -2 },
    output: "ripgrep (rg) is not installed. Install from https://github.com/BurntSushi/ripgrep",
  }
}
```
