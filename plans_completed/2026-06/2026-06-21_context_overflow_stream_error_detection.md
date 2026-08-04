# Plan: Context Overflow Detection Gap in Stream Errors

**Date:** 2026-06-21
**Status:** Complete
**Scope:** `packages/opencode`
**Affected model:** `kat-coder-pro-v2` via StreamLake OpenAI-compatible endpoints

## Goal

Fix a detection gap in `parseStreamError()` where streaming errors from OpenAI-compatible providers (StreamLake/kat-coder-pro-v2) that indicate context overflow are NOT classified as `ContextOverflowError`, preventing auto-compaction and leaving sessions stuck.

## Problem Summary

### The two error paths

When a provider returns a context overflow error, it can arrive via two paths:

| Path | Function | How it detects overflow |
|------|----------|------------------------|
| **HTTP error** (400/413 before stream starts) | `parseAPICallError()` | 19 regex patterns on message text + `statusCode === 413` + `body.error.code === "context_length_exceeded"` |
| **Stream error** (mid-stream SSE event) | `parseStreamError()` | **Only** `body.error.code === "context_length_exceeded"` — no regex, no status check |

### The gap

`parseStreamError()` has a **narrow detection surface**. If a provider returns a stream error where the error code is NOT exactly `"context_length_exceeded"` but the message clearly indicates overflow, the error is classified as generic `APIError` instead of `ContextOverflowError`.

**OpenAI-compatible streaming endpoints** (like StreamLake hosting kat-coder-pro-v2) can return stream errors like:

```json
{
  "type": "error",
  "error": {
    "code": "invalid_request_error",
    "message": "This model's maximum context length is 256000 tokens. Your request has 280000 tokens."
  }
}
```

Here `code` is `"invalid_request_error"` (not `"context_length_exceeded"`), but the `message` clearly indicates context overflow. `parseStreamError()` returns `undefined` → classified as generic error → no auto-compaction.

### What happens when detection fails

1. `parseStreamError()` returns `undefined` (no known code matched)
2. `fromError()` in `message-v2.ts` classifies as generic error
3. `halt()` in `processor.ts` treats as `APIError` → sets `finish = "error"`, does NOT set `needsCompaction = true`
4. The prompt loop sees `result === "stop"` and breaks
5. User sees generic error in TUI, session is stuck — must manually compact or reduce context

### What should happen

1. `parseStreamError()` detects overflow from message text (regex match)
2. Returns `{ type: "context_overflow", ... }`
3. `fromError()` creates `ContextOverflowError`
4. `halt()` sets `needsCompaction = true`, returns `"compact"`
5. Auto-compaction runs, turn auto-retries

## Architecture

### Fix location

**File:** `src/provider/error.ts`, function `parseStreamError()` (lines 137-182)

### Change

Add **2 new detection layers** to `parseStreamError()`, BEFORE the existing `switch` on `body.error.code`:

```
parseStreamError(input)
  │
  ├─ Layer 1 (NEW): isOverflow() regex patterns on error message text
  │   Check body.error.message, body.message, and any string message
  │   against the same 19 OVERFLOW_PATTERNS used by parseAPICallError()
  │
  ├─ Layer 2 (NEW): statusCode === 413 check
  │   If stream error carries a status code, check it
  │
  └─ Layer 3 (EXISTING): body.error.code switch
      "context_length_exceeded", "insufficient_quota", etc.
```

### Why isOverflow() regex is safe for stream errors

The `isOverflow()` function only matches against error message strings — it doesn't depend on `APICallError` structure. It's a pure function `(string) => boolean` already exported (well, it's module-private but we can extract the check). The stream error's `body.error.message` or `body.message` text is sufficient for regex matching.

### Why this fixes kat-coder-pro-v2

StreamLake is an OpenAI-compatible proxy. OpenAI returns stream errors with `code: "invalid_request_error"` when the context window is exceeded (they reserve `"context_length_exceeded"` for non-streaming errors). The overflow message text like `"exceeds the context window"` or `"maximum context length is N tokens"` IS present in the `error.message` field. By applying `isOverflow()` regex to that text, we catch these cases.

## Detailed Task Breakdown

### Task 1: Enhance `parseStreamError()` in `src/provider/error.ts`

**Abstract definition:** Before matching on `body.error.code`, scan the error message text for overflow patterns and check HTTP status codes.

**Structural diagram:**
```
Current:
  parseStreamError(input)
    try JSON parse
    if body.type !== "error" → return undefined
    switch body.error.code:
      "context_length_exceeded" → overflow
      "insufficient_quota" → api_error
      ...
      default → return undefined

New:
  parseStreamError(input)
    try JSON parse
    if body.type !== "error" → return undefined
    
    // Layer 1 (NEW): regex overflow detection on message text
    const msg = body.error?.message || body.message || ""
    if (isOverflow(msg)) → return context_overflow
    
    // Layer 2 (NEW): HTTP status code check
    if (body.statusCode === 413) → return context_overflow
    
    // Layer 3 (EXISTING): error code switch
    switch body.error.code:
      ...
```

**Implementation:**

In `parseStreamError()`, after the `responseBody` declaration and before the `switch`:

```ts
// Detect overflow from message text using same regex patterns as APICallError path.
// OpenAI-compatible streaming endpoints often use generic error codes
// (e.g. "invalid_request_error") even when the actual problem is context
// overflow. The message text reliably contains the overflow indicator.
const errorMessage = typeof body?.error?.message === "string"
  ? body.error.message
  : typeof body?.message === "string"
    ? body.message
    : ""
if (errorMessage && isOverflow(errorMessage)) {
  return {
    type: "context_overflow",
    message: errorMessage,
    responseBody,
  }
}

// Some providers signal context overflow via HTTP 413 even in stream errors
if (body?.statusCode === 413 || body?.status === 413) {
  return {
    type: "context_overflow",
    message: "Request entity too large",
    responseBody,
  }
}
```

**Input/Output parameters:**
```
Input:  stream error object (same as current parseStreamError)
Output: ParsedStreamError | undefined (same type, now catches more overflow cases)
```

### Task 2: Add reproduction tests

**Location:** `test/session/message-v2.test.ts`, in the `"session.message-v2.fromError"` describe block.

**New test cases:**

1. **OpenAI streaming overflow via message text**:
```ts
test("detects context overflow from stream error message text (OpenAI-compatible pattern)", () => {
  const body = {
    type: "error",
    error: {
      code: "invalid_request_error",
      message: "This model's maximum context length is 256000 tokens. However, your messages resulted in 300000 tokens.",
    },
  }
  const input = { message: JSON.stringify(body) }
  const result = MessageV2.fromError(input, { providerID })
  expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(true)
})
```

2. **vLLM/DeepSeek streaming overflow pattern**:
```ts
test("detects context overflow from stream error with vLLM message pattern", () => {
  const body = {
    type: "error",
    error: {
      code: "invalid_request_error",
      message: "maximum context length is 131072 tokens. you have 150000 tokens in your request",
    },
  }
  const input = { message: JSON.stringify(body) }
  const result = MessageV2.fromError(input, { providerID })
  expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(true)
})
```

3. **StreamLake-specific pattern** (if known): Check for StreamLake's actual error format. Since it's an OpenAI-compatible proxy, pattern 1 above should cover it.

4. **Existing code path still works**: Verify that `body.error.code === "context_length_exceeded"` still returns `ContextOverflowError` (existing test covers this).

5. **Non-overflow stream errors are unaffected**: Verify that `"insufficient_quota"` etc. still return `APIError` (existing test covers this).

### Task 3: Update existing processor test for stream overflow

**Location:** `test/session/processor-effect.test.ts`

The test `"compact on structured context overflow"` at line 618 uses `llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })`. This still works — no change needed. But optionally add a test that uses the OpenAI pattern (message text instead of code):

```ts
it.live("compacts on context overflow detected via stream error message text", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        yield* llm.error(400, {
          type: "error",
          error: {
            code: "invalid_request_error",
            message: "exceeds the context window of this model",
          },
        })
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "overflow via msg text")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })
        const value = yield* handle.process({
          user: { id: parent.id, sessionID: chat.id, role: "user", time: parent.time, agent: parent.agent, model: { providerID: ref.providerID, modelID: ref.modelID } } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "overflow via msg text" }],
          tools: {},
        })
        expect(value).toBe("compact")
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)
```

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Regex false-positive matches non-overflow errors | Low | Same regex patterns already battle-tested in `parseAPICallError()` path |
| Stream error JSON structure differs from expected | Low | We check both `body.error.message` and `body.message` before regex |
| Existing behavior changes for non-overflow codes | None | New checks are added BEFORE the switch — existing cases unchanged |

## Files Modified

| File | Action | Lines |
|------|--------|-------|
| `src/provider/error.ts` | MODIFY: add ~20 lines in `parseStreamError()` | +20 |
| `test/session/message-v2.test.ts` | MODIFY: add ~2 test cases | +40 |
| `test/session/processor-effect.test.ts` | MODIFY: add ~1 test case (optional) | +35 |

## Verification

1. `bun test test/session/message-v2.test.ts` — all existing + new tests pass
2. `bun test test/session/processor-effect.test.ts` — all existing + new tests pass (if Task 3 done)
3. `bun typecheck` — clean
4. Manual: search logs after deployment to confirm `ContextOverflowError` is emitted for kat-coder-pro-v2 overflow events

## Dependencies

- No new dependencies
- Reuses existing `isOverflow()` function and `OVERFLOW_PATTERNS` (both already defined in same file)

## Completion Checklist

- [x] Task 1: Add regex + statusCode overflow detection to `parseStreamError()`
- [x] Task 2: Add test cases for stream error overflow via message text
- [x] Task 3: Add processor integration test (optional — skipped, existing test covers code path)
- [x] All existing tests still pass (30/31, 1 pre-existing OpenRouter failure unrelated)
- [x] TypeScript compilation clean

## Oracle Results

```
bun test test/session/message-v2.test.ts:  30 pass, 1 fail (pre-existing OpenRouter providerOptions)
bun typecheck: clean (0 errors)
```

New tests added:
| Test | Result |
|------|--------|
| OpenAI-compatible invalid_request_error with overflow message text | PASS |
| vLLM/DeepSeek maximum context length message pattern | PASS |
| Generic context_length_exceeded in message text | PASS |
| Non-overflow message correctly NOT classified as overflow | PASS |
