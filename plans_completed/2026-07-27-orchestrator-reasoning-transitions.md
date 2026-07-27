# Controlled Reasoning transitions

## Goal

Keep Reasoning Mode user-selectable in the UI, while restoring internal
`reasoning_enter` and `reasoning_exit` controls exclusively for the native
Orchestrator. Build, Plan, Reasoning, custom agents, and MCP must not receive
their schemas.

## Prior art

reuse: N/A — local policy and registry correction.

## Implementation steps

- [x] Restore `ReasoningExitTool` alongside `ReasoningEnterTool`.
- [x] Register both transition tools, gated to the immutable native Orchestrator.
- [x] Remove transition permissions from Build and deny them to all non-Orchestrator agents.
- [x] Add registry and permission regressions for controlled transition visibility.
- [x] Update Reasoning Mode documentation and verify focused tests plus typecheck.

## Verification [Exact]

- Agent policy tests: 3 pass, 0 fail.
- Registry visibility tests: 3 pass, 0 fail.
- Transition persistence test: 1 pass, 0 fail (`reasoning_enter` then
  `reasoning_exit` writes the expected session agents).
- SessionTools protected-memory test: 1 pass, 0 fail.
- Reasoning-memory compaction regression: 1 pass, 0 fail.
- `bun typecheck`: exit 0.

## Smoke Tests

### Baseline

| Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|
| `bun test --timeout 60000 test/agent/agent.test.ts --test-name-pattern "reasoning"` (`packages/opencode`) | Reasoning memory boundary passes | 2 pass, 0 fail |
| `bun test --timeout 60000 test/tool/registry.test.ts --test-name-pattern "reasoning"` (`packages/opencode`) | native Reasoning exposes memory only | 2 pass, 0 fail |

### Post-implementation oracles

| Command (cwd) | Pass criterion |
|---|---|
| focused agent and registry tests (`packages/opencode`) | only native Orchestrator sees both reasoning transition tools |
| `bun typecheck` (`packages/opencode`) | exits 0 |
