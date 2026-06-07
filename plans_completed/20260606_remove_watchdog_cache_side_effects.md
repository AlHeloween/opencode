# Remove Watchdog And Cache-Control Side Effects

**Status:** completed
**Created:** 2026-06-06
**Completed:** 2026-06-07

## Goal

Remove automatic stream-stall and prompt-cache control-flow behavior that can interrupt valid work or degrade sessions over time. Keep passive cache metrics and diagnostics only.

## Rationale

- Stream silence is not proof of failure. A provider may be waiting, a tool may be slow, or a user-facing question may remain unanswered longer than the timeout.
- Provider-side prompt caching is not directly controllable. Heuristics that force rebaseline, retry, or compaction can create more failures than they prevent.
- Mid-implementation compaction should remain explicit/user-driven except for real context-overflow handling.
- Global/default DB plans are obsolete because project-scoped DB routing has already replaced the old architecture.

## Tasks

### [x] Retire completed plans

- Moved `20260605_recent_commit_correctness_fix.md` to `plans_completed/`.
- Moved `20260604_cache_poison_cold_start_deadlock_fix.md` to `plans_completed/`.

### [x] Retire obsolete or diagnostic active plans

- Moved pre-existing failure diagnostics to `research_done/`.
- Moved stream-stall, cache-control, per-model cache, and obsolete global-DB plans to `obsolete/plans/`.

### [x] Remove stream-stall watchdog control flow

- Remove `Stream.timeout` watchdog from `SessionProcessor.process()`.
- Remove the `"stalled"` result type.
- Remove prompt and compaction handling for `result === "stalled"`.

### [x] Remove cache-control side effects

- Remove cache-poison state tracking and reset state.
- Remove `needsCacheRebaseline` from processor handles.
- Remove `session.cache_collapsed` event and TUI toast.
- Keep cache hit/miss metric logging and passive `cacheRatio()`.

### [x] Verify

- [x] `bun typecheck` passes from `packages/opencode` (`cmd_runner` run `20260607T081202Z_c3fcbf85`).
- [x] Regenerated JavaScript SDK after removing `session.cache_collapsed` from the event surface.
- [x] `bun test --timeout 30000 test/server/session-messages.test.ts test/server/session-select.test.ts test/server/httpapi-json-parity.test.ts` passes (8 pass).
- [x] `bun test --timeout 30000 test/session/processor-effect.test.ts -t 'computes cache ratio'` passes (1 pass, 12 filtered out).
- [x] `bun test --timeout 30000 test/session/processor-effect.test.ts -t "record aborted errors and idle state"` passes (1 pass, 24 filtered out; `cmd_runner` run `20260607T080950Z_a55468aa`).
- [x] `bun test --timeout 30000 test/session/compaction.test.ts` passes (48 pass; `cmd_runner` run `20260607T081202Z_05d9ac2c`).
