# TUI CPU Performance Audit — 2026-07-16

**Status:** Completed — core idle + streaming items done; optional follow-ups deliberately not pursued
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

## Not pursuing (low benefit / quality risk)

1. **Session-view memo blast radius** — easy to regress streaming correctness; only if profiling still shows Solid as top after current fixes.
2. **Native/Zig decorative animation** — idle JS drivers already gated; large native surface for little UX gain.

Reopen only with measured CPU evidence.
