# Permissive read-tool ACL

## Goal

Allow ordinary diagnostic tools by default for planning and research roles while retaining explicit boundaries for mutation, shell execution, and delegation. `reasoning_mode` remains permanently memory-only.

## Grounding

- `packages/opencode/src/agent/agent.ts:159` gives `plan_mode` a `* -> deny` rule followed by an allow-list.
- `packages/opencode/src/agent/agent.ts:309` and `:354` use the same deny-first model for `explorer_agent` and `researcher_agent`.
- `packages/opencode/src/session/tools.ts:124` keeps tool schemas stable and rejects unauthorized executions at runtime; changing the ACL will not reshape the provider tool catalog.
- `packages/opencode/src/agent/agent.ts:214` defines `reasoning_mode` as the exception and is out of scope.

## Tasks

- [x] Replace deny-first read allow-lists for `plan_mode`, `explorer_agent`, and `researcher_agent` with default permissions plus explicit denials for `bash`/`cmd`/`powershell`/`run`, `apply_patch`, `multiedit`, `restore`, `pipeline`, `jobkill`, and destructive classes. `edit`/`write` stay scoped to `plans/*` in plan mode and are denied for explorer/researcher. `plan_mode` retains only bounded `task` delegation to `explorer_agent`; explorer and researcher deny `task`.
- [x] Add regression coverage that these roles allow `dbread`, `logsearch`, and `session-read`, while shell, mutation, `pipeline`, task delegation, and `reasoning_mode` isolation stay intact.

## Smoke Tests

Baseline [Exact]:

```text
cwd: packages/opencode
bun test test/agent/agent.test.ts --test-name-pattern "plan agent|explore agent|reasoning agent"
expected: exit 0
actual: exit 0; 7 passed, 38 filtered (2026-08-17)
```

Post-implementation oracle:

```text
cwd: packages/opencode
bun test test/agent/agent.test.ts --test-name-pattern "plan agent|explore agent|researcher agent|reasoning agent"
expected: exit 0; diagnostics allowed for plan/explorer/researcher; shell and mutation still denied; reasoning remains memory-only
```

Blast radius: native-agent permission construction and its unit tests only. Tool schemas and KV-cache wire bytes are unchanged.
