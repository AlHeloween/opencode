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

## 2026-06-07 Remove Watchdog And Cache-Control Side Effects

Reason: finish cleanup of automatic stream-stall and prompt-cache control-flow behavior, remove the processor scratch `MessageTable` dual-write, and keep cache handling passive.

Changes:

- Updated `packages/opencode/src/session/processor.ts` so cleanup persists through `session.updateMessage()` only.
- Moved `plans/20260606_remove_watchdog_cache_side_effects.md` to `plans_completed/20260606_remove_watchdog_cache_side_effects.md` after plan validation passed.
- Updated `_application_workflow_diagram.md` to remove stale stalled/cache-collapse workflow descriptions.

Script output:

- `bun test --timeout 30000 test/session/processor-effect.test.ts -t "record aborted errors and idle state"`: passed, 1 pass, 24 filtered out (`cmd_runner` run `20260607T080950Z_a55468aa`).
- `bun typecheck`: passed (`cmd_runner` run `20260607T081202Z_c3fcbf85`).
- `bun test --timeout 30000 test/session/compaction.test.ts`: passed, 48 pass (`cmd_runner` run `20260607T081202Z_05d9ac2c`).
