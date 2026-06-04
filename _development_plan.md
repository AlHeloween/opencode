# Development Plan

## 2026-06-04 Cache Collapse And Stream Stall Recovery

Goal: reduce prompt-cache collapse cost and recover safely from LLM streams that stall before tool execution.

Tasks:

- [x] Replace ratio-only cache collapse detection with input-token-delta detection.
- [x] Add cache rebaseline signaling without blocking the processor loop.
- [x] Publish and surface `session.cache_collapsed` in the TUI.
- [x] Regenerate SDK event types for `session.cache_collapsed`.
- [x] Add conservative stream stall timeout in `SessionProcessor`.
- [x] Return `"stalled"` for pre-tool stream stalls and auto-continue from `SessionPrompt`.
- [x] Map compaction stream stalls to `"stop"`.
- [ ] Add reliable dedicated runtime watchdog tests.
- [ ] Add DeepSeek reasoning-content diagnostics.

Verification:

- [x] `bun typecheck` from `packages/opencode`.
- [x] `bun test test/session/processor-effect.test.ts --test-name-pattern "cache poison|input delta|cold start"`.
- [x] `bun test test/provider/transform.test.ts`.
