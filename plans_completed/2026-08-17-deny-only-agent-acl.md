# Deny-only native-agent ACL

## Goal

Make the native-agent permission model internally consistent: the base policy permits normal capabilities; each ordinary role lists only capabilities it prohibits. `reasoning_mode` remains its explicit memory-only allow-list exception, and hidden title/summary agents remain zero-capability exceptions.

## Grounding

- `packages/opencode/src/agent/agent.ts:96` currently sets `*` to allow but separately denies several ordinary policies, forcing roles to re-open them with local allow rules.
- `packages/opencode/src/agent/agent.ts:146`, `:167`, and `:258` contain those stale local allow overrides.
- `packages/opencode/src/tool/plan.ts:81` and `:149` have no identity check, so the ACL is the sole owner of `plan_enter` / `plan_exit`; build owns entry and plan owns exit.
- `packages/opencode/src/tool/reasoning.ts:53` independently requires the native orchestrator for reasoning transitions; allowing any other identity—or `reasoning_mode` itself—to invoke either tool causes a late runtime failure. Exit from reasoning mode remains an external/native-orchestrator control-plane action, not a reasoning tool capability.
- Native per-agent configuration may add denials but cannot reopen a native role boundary; otherwise config could restore invalid transitions after the built-in ACL.
- The completed diagnostic ACL plan is historical phase one; this plan revises the base invariant rather than reverting it.

## Tasks

- [x] Make the base policy default-allow for ordinary tool policies; retain only universal safety asks/denies. Replace native ordinary-role allow overrides with explicit deny sets. Keep path-scoped plan/orchestrator editing, reasoning mode, and hidden agents as the documented exceptions.
- [x] Add focused tests for the deny-only invariant: ordinary diagnostics are allowed, role boundaries are explicit denies, only build/plan own their respective plan transitions, and only orchestrator owns reasoning transitions.

## Smoke Tests

Baseline [Exact]:

```text
cwd: packages/opencode
bun test test/agent/agent.test.ts --test-name-pattern "plan agent is read-only|explore agent denies|researcher agent allows|reasoning agent software|project configuration cannot reopen reasoning|plan agent preserves external"
expected: exit 0
actual: exit 0; 6 passed, 40 filtered, 74 assertions (2026-08-17)
```

Post-implementation oracle:

```text
cwd: packages/opencode
bun test test/agent/agent.test.ts --test-name-pattern "plan agent|explore agent|researcher agent|reasoning agent|orchestrator"
expected: exit 0; no ordinary role-specific allow override, diagnostics remain available, role denials and transition ownership hold
actual: exit 0; 4 focused tests passed, 28 assertions (2026-08-17)
```

Execution oracle:

```text
cwd: packages/opencode
bun test test/session/tools.test.ts
expected: exit 0; reasoning_mode rejects reasoning_exit through SessionTools before the native-orchestrator guard executes; provider schemas remain unchanged
actual: exit 0; 2 passed, 21 assertions (2026-08-17)
```

Blast radius: `packages/opencode/src/agent/agent.ts` native permission construction and `packages/opencode/test/agent/agent.test.ts`. Provider tool schemas are unchanged.
