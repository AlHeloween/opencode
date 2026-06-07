# Stream Stall Recovery And Cache Poisoning Diagnostics Plan

Status: active
Created: 2026-06-04
Goal: recover sessions that stall until manual abort/continue, and add enough prompt-cache diagnostics to identify the first request-section divergence behind DeepSeek cache collapse.

## Abstract Definition

Let each LLM request be keyed by `K = sessionID:agent:modelID` and represented by ordered sections:

`R = system || provider_options || tools || messages || tool_choice`

DeepSeek cache health for a completed request uses the normalized token object returned by `Session.getUsage`:

`cache_ratio = cacheReadTokens / max(1, inputTokens + cacheReadTokens + cacheWriteTokens)`

Here `inputTokens`, `cacheReadTokens`, and `cacheWriteTokens` are already-normalized values from the persisted assistant `tokens` object, not raw provider usage fields.

A stream stall occurs when request `R_i` starts but no meaningful progress event arrives before timeout `T`.

A cache collapse occurs when previous healthy request `R_i` has `cache_ratio >= H` and later request `R_j` for the same `K` has `cache_ratio <= L`, where default thresholds are `H = 0.85`, `L = 0.25`.

A cache-poison stop condition occurs when two consecutive completed requests for the same `K` remain collapsed after a healthy baseline. The processor should stop the current loop before more reasoning/tool calls accumulate on a broken cache prefix.

## Structural Diagram

```text
session.prompt loop
  -> SessionTools.resolve
  -> MessageV2.toModelMessagesEffect
  -> LLM.stream/process
      -> request section hash logging
      -> provider/gateway stream
      -> progress watchdog
          -> progress: continue normal processing
          -> timeout before tool execution: return stalled outcome, abort stalled assistant, exclude it, auto-continue
          -> timeout after tool execution: mark recoverable error, do not replay blindly
  -> usage metrics
      -> cache collapse detector
      -> second sequential collapse: stop current processor loop and request explicit rebaseline
      -> cache diagnostics log
```

## Inputs And Outputs

Inputs:
- Session/message identifiers from `SessionPrompt` and `SessionProcessor`.
- Provider/model/agent identifiers from `LLM.stream` input.
- Stream events: reasoning deltas, text deltas, tool-call deltas, usage/final step.
- Usage metrics: `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`.
- Request sections: system prompt, provider options, resolved tools, model messages.

Outputs:
- Stalled assistant messages finalized with explicit stalled/aborted metadata.
- Fresh auto-continued assistant message when retry is safe.
- Structured logs for stream stalls and cache collapse.
- Debug-safe section hashes and lengths; no raw prompts, raw user content, raw tool schemas, or secrets.

## Tasks

- [x] Add conservative stream stall timeout.
  - Completion: `SessionProcessor.process` now times out stalled streams and distinguishes pre-tool stalls from post-tool stalls. Dedicated runtime tests remain pending because current LLM-server live tests time out in this environment.

- [x] Define processor-to-prompt stalled outcome integration.
  - Completion: `SessionProcessor.process` can signal a stalled request to `SessionPrompt` without confusing it with normal `stop`, `continue`, or `compact` outcomes.

- [x] Add conservative automatic stop-and-continue.
  - Completion: pre-tool stalls return `"stalled"`; `SessionPrompt` marks the assistant as errored and continues the loop. Post-tool stalls are handled as `"stop"` to avoid duplicate execution.

- [ ] Stabilize deterministic request-shape surfaces.
  - Completion: tests prove tool names/schema serialization order is deterministic across repeated resolves, so hashes can be compared reliably.

- [x] Add debug-safe request-section hash logging.
  - Completion: logs include hashes/lengths for system, provider options, tools, model messages, and prompt cache key presence/hash without raw content.

- [x] Add cache-collapse detector keyed by `sessionID:agent:modelID`.
  - Completion: detector tests prove healthy-to-collapsed token sequences are classified and cold starts are ignored; log-spam assertions remain part of broader logging tests.

- [x] Add sequential cache-poison stop rule.
  - Completion: two consecutive collapsed requests after a healthy baseline stop the current processing loop before additional reasoning/tool calls continue on the broken cache prefix.

- [x] Add explicit cache rebaseline continuation path.
  - Completion: after a sequential cache-poison stop, the next request is allowed to rebuild provider-side cache from the full system prompt and preserved history, without compaction and without discarding reasoning history.

- [ ] Add DeepSeek reasoning-content diagnostics.
  - Completion: tests/logs expose assistant message ID, tool-call presence, reasoning lengths, emitted `reasoning_content` length, and synthesized-empty reasoning status.

- [ ] Add targeted watchdog and diagnostic test files.
  - Completion: cache-collapse detector tests were added to `test/session/processor-effect.test.ts`; dedicated watchdog, reasoning diagnostics, and deterministic request-hashing tests remain open.

- [ ] Verify full implementation.
  - Completion: `bun typecheck` passes from `packages/opencode`; targeted runtime watchdog tests remain open.

## Test Cases

1. Stream starts and emits no reasoning/text/tool delta before timeout.
   Expected: current assistant is marked stalled/aborted, excluded from context, and a fresh assistant turn starts if no tool execution occurred.

2. Stream emits progress before timeout.
   Expected: watchdog does not interfere.

3. Stream stalls after a tool call was emitted or executed.
   Expected: no blind replay; user-visible recoverable error or safe abort path is used.

4. Cache metrics sequence `0.99 -> 0.02` for same `sessionID:agent:modelID`.
   Expected: `bug: prompt cache collapsed` log with previous/current metrics and section hashes.

5. Cache metrics remain low after already collapsed.
   Expected: no repeated warning spam unless section hash changes again.

6. Cache metrics collapse twice sequentially after a healthy baseline.
   Expected: current processor loop stops with an explicit cache-poison state, no further tool calls are executed in that loop, and the next continuation request is treated as a cache rebaseline attempt.

7. DeepSeek assistant tool-call turn includes reasoning parts.
   Expected: OpenAI-compatible serialization emits `reasoning_content` and diagnostics report nonzero emitted length.

8. DeepSeek assistant tool-call turn lacks reasoning parts.
   Expected: current synthesized-empty behavior is visible in diagnostics and can be distinguished from preserved reasoning.

## Verification Commands

Run from `packages/opencode`:

```bash
bun test test/provider/transform.test.ts test/session/message-v2.test.ts
bun typecheck
```

Additional targeted tests should be added next to the implementation files selected during coding.

Expected new or updated tests include:
- `test/session/processor-watchdog.test.ts`
- `test/session/cache-collapse.test.ts`
- `test/session/reasoning-diagnostics.test.ts`
- provider/session transform tests for deterministic tool/request hashing

## Integration Notes

- `SessionProcessor.process` currently returns `"compact" | "stop" | "continue"`; stall recovery needs either a new `"stalled"` outcome or an equivalent typed signal that `SessionPrompt` can distinguish from normal completion.
- `SessionPrompt` should own the auto-continue decision because it already creates assistant messages, filters future context, and controls the loop continuation.
- Request-section hashes for tools/messages must be computed from deterministic serialization; object insertion order must not determine hash identity.
- Sequential cache-poison handling should not trigger compaction. The goal is to stop the damaged loop and allow an explicit continuation request to rebuild a coherent provider-side cache over the full system prompt and preserved history.
- Cache-poison stop is different from stream stall. A stalled stream is no-output local recovery; cache-poison stop is a completed-output quality/cost guard after two consecutive collapsed cache ratios.

## Non-Goals

- Do not dump raw request bodies or raw prompts into logs.
- Do not assume H2/H1 is the root cause when manual stop/continue recovers the session.
- Do not remove DeepSeek `reasoning_content` handling; DeepSeek documentation requires it for tool-call turns.
- Do not retry after tool execution without duplicate-execution safety.
