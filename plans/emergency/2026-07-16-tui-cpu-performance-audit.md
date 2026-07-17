# TUI CPU Performance Audit — 2026-07-16

**Status:** In progress — highest-impact idle drivers reduced; remaining items tracked below.
**Scope:** `packages/opencode/src/cli/cmd/tui/` + `packages/opentui/packages/core/src/`

---

## Implementation status

| Issue | Severity | Status |
|-------|----------|--------|
| #1 BgPulse perpetual 100ms interval | CRITICAL | **Done** — interval fully stopped on blur; only runs while focused (`bg-pulse.tsx`) |
| #2 Logo 30fps idle loop | CRITICAL | **Done** — home logo is event-driven; `idle` shimmer at 10fps; interactive 33ms then falls back |
| #3 Win32 `SetConsoleMode` poll | HIGH | **Done** — event-driven `setRawMode` + 1000ms backstop (`win32.ts`) |
| #4 SSE delta store cascade | HIGH | **Done** — leading-edge + 25ms batch, anti-truncation merge (`sync.tsx`, commit `cdc81a2a40`) |
| #5 Syntax highlighting re-trigger | HIGH | Open — Code.ts re-highlight still hot during stream |
| Remaining audit items | MED–LOW | Open — see original evidence if re-expanded |

Tests: `packages/opencode/src/cli/cmd/tui/idle-cpu.test.ts`, `sync-rendering.test.ts`.

---

## Remaining work (optional)

1. Debounce tree-sitter re-highlight during streaming (prior attempt reverted for blank/dupe text — re-approach carefully).
2. Session-view memo blast radius if profiling still shows hot paths after idle fixes.
3. Consider native/Zig animation drivers for decorative effects so JS intervals are unnecessary.

## Non-goals

- Disabling decorative UI entirely.
- Changing Solid store architecture wholesale without profiling evidence after the idle fixes.
