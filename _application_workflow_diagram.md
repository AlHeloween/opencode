# Application Workflow Diagram

## Session Prompt To Processor Flow

1. `packages/opencode/src/session/prompt.ts` / `SessionPrompt.loop`
   - Input: user/session/model/agent state.
   - Output: assistant message or loop break.
   - Logic: build system prompt and model messages, call `SessionProcessor.process`, handle `"stalled"`, `"stop"`, `"compact"`, and cache rebaseline signals.

2. `packages/opencode/src/session/processor.ts` / `SessionProcessor.process`
   - Input: `LLM.StreamInput`.
   - Output: `"compact" | "stop" | "continue" | "stalled"`.
   - Logic: stream provider events, update message parts, apply stream stall timeout, run cleanup, return typed outcome.

3. `packages/opencode/src/session/processor.ts` / `trackCachePoison`
   - Input: cache key, message ID, normalized token usage.
   - Output: ratio diagnostics, collapse/poison flags, input delta.
   - Logic: track previous input tokens per key; collapse when input delta exceeds threshold; poison after consecutive collapses.

4. `packages/opencode/src/session/session.ts` / `Session.Event.CacheCollapsed`
   - Input: session/model/token details.
   - Output: bus event payload.
   - Logic: typed fire-and-forget event for cache-collapse notification.

5. `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` / session route event handler
   - Input: `session.cache_collapsed` event.
   - Output: non-blocking toast.
   - Logic: filter to active session and show model/token details.

Coverage estimate vs actual codebase: 7%.

This diagram covers the modified session-processing and TUI notification path only, not the full opencode runtime.
