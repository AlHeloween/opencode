# Reasoning mode: controlled exit

## Context / goal

Reasoning Mode is a protected memory-only phase. A model must not be able to
leave it by calling a tool. User mode selection remains available; the native
Orchestrator alone may use controlled transition tools for its managed model.

## Prior art

reuse: N/A — narrow local permission/registration correction; no
`universalsearch` capability is available in this workspace.

## Implementation steps

- [x] Record the focused reasoning permission baseline.
- [x] Remove general-model access to `reasoning_exit`; retain it only for the
  native Orchestrator.
- [x] Assert that Reasoning permits only `memory`; typecheck.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test --timeout 30000 test/agent/agent.test.ts --test-name-pattern "reasoning agent software guardrail"` (`packages/opencode`) | current test passes while allowing memory + exit | 1 pass, 0 fail [Exact] |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | same focused test | Reasoning allows only `memory`; only Orchestrator may transition |
| 2 | `bun typecheck` (`packages/opencode`) | exits 0 |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation only after baseline.
- [x] Post-implementation smoke passed before completion.

## Verification [Exact]

- Reasoning and native-Orchestrator policy tests: 3 pass, 0 fail.
- `bun typecheck`: exit 0.
