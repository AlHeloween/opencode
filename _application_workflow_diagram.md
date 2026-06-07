# Application Workflow Diagram

## Session Prompt To Processor Flow

1. `packages/opencode/src/session/prompt.ts` / `SessionPrompt.loop`
   - Input: user/session/model/agent state.
   - Output: assistant message or loop break.
   - Logic: build system prompt and model messages, call `SessionProcessor.process`, handle `"stop"` and `"compact"`, and leave cache metrics passive.

2. `packages/opencode/src/session/processor.ts` / `SessionProcessor.process`
   - Input: `LLM.StreamInput`.
   - Output: `"compact" | "stop" | "continue"`.
   - Logic: stream provider events, update message parts, mark interruptions as aborted, run cleanup, return typed outcome.

3. `packages/opencode/src/session/processor.ts` / `cacheRatio`
   - Input: token usage with input/cache read/cache write counts.
   - Output: passive cache-read ratio.
   - Logic: compute cache-read share for diagnostics without changing processor control flow.

4. `packages/opencode/src/session/session.ts` / `Session.updateMessage`
   - Input: message info.
   - Output: updated message info.
   - Logic: run `MessageV2.Event.Updated`, whose projector persists the message row.

5. `packages/opencode/src/session/compaction.ts` / compaction continuation
   - Input: compaction prompt state and processor result.
   - Output: compacted session continuation or stop.
   - Logic: retry context-overflow handling and user-driven compaction without stream-stall fallback.

Coverage estimate vs actual codebase: 6%.

This diagram covers the modified session-processing and compaction path only, not the full opencode runtime.
