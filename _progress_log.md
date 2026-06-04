# Progress Log

## 2026-06-04 Cache Collapse And Stream Stall Recovery

Reason: fix DeepSeek/Anthropic prompt-cache collapse detection, prevent cache-poison loop blocking, notify users, and add conservative pre-tool stream stall recovery.

Changes:

- Updated `packages/opencode/src/session/processor.ts` with input-delta collapse detection, rebaseline signaling, and stream stall timeout handling.
- Updated `packages/opencode/src/session/prompt.ts` to consume rebaseline signals and auto-continue pre-tool stalls.
- Updated `packages/opencode/src/session/compaction.ts` to map stalled compaction streams to stop.
- Updated `packages/opencode/src/session/session.ts` with `Session.Event.CacheCollapsed`.
- Updated `packages/opencode/src/provider/transform.ts` to include DeepSeek in cache marker application.
- Updated `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` to show cache-collapse toasts.
- Regenerated SDK event type surface for `session.cache_collapsed`.
- Updated plans under `plans/`.

Script output:

- `bun typecheck`: passed.
- `bun test test/session/processor-effect.test.ts --test-name-pattern "cache poison|input delta|cold start"`: 6 passed.
- `bun test test/provider/transform.test.ts`: 143 passed.

Notes:

- Dedicated runtime watchdog tests remain pending because existing LLM-server live tests in `processor-effect.test.ts` time out in this environment.
