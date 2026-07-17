# TUI CPU Performance Audit — 2026-07-16

**Status:** Core idle + streaming items done
**Scope:** `packages/opencode/src/cli/cmd/tui/` + `packages/opentui/packages/core/src/`

---

## Implementation status

| Issue | Severity | Status |
|-------|----------|--------|
| #1 BgPulse perpetual 100ms interval | CRITICAL | **Done** — interval fully stopped on blur |
| #2 Logo 30fps idle loop | CRITICAL | **Done** — event-driven home; idle shimmer 10fps |
| #3 Win32 `SetConsoleMode` poll | HIGH | **Done** — setRawMode + 1000ms backstop |
| #4 SSE delta store cascade | HIGH | **Done** — leading-edge + 25ms batch, anti-truncation |
| #5 Syntax highlighting re-trigger | HIGH | **Done** — streaming debounce with **trailing flush** + flush when `streaming=false` (`Code.ts`) |

Tests: `idle-cpu.test.ts`, `sync-rendering.test.ts`, `Code.test.ts` (streaming debounce).

---

## Optional follow-ups

1. Session-view memo blast radius if profiling still shows hot paths.
2. Native/Zig animation drivers for decorative effects.
