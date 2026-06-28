---
status: execution
owner: orchestrator
created: 2026-06-28
reproduce:
  - cd packages/opencode && bun typecheck
  - plans/ explored for correctness
---

# Orchestrator Plan Edit & Delegate Capability

## Goal

Enable the orchestrator agent to (a) directly edit and create plan files (`plans/*.md`) and (b) delegate tasks to sub-agents via the `task` tool. Currently the orchestrator is purely read-only — it can only INSTRUCT the main session to manage plans. This blocks AGI mode where the orchestrator commands workers autonomously.

## Problem

The orchestrator agent's permission block in `packages/opencode/src/agent/agent.ts` has:

```
tool     | permission      | problem
---------|-----------------|--------
edit     | {*:deny, ...}   | can't edit plan files
write    | deny            | can't create plan files
task     | deny            | can't delegate to sub-agents
```

And the prompt (`src/agent/prompt/orchestrator.txt`) reinforces these restrictions, saying "You NEVER edit plan files directly" and listing `edit`, `write`, `task` as tools it does not call.

## Solution

### 1. Permission changes (agent.ts)

**`edit`**: Add `plans/*` allow path alongside the existing orchestrator memory file path:
```ts
edit: {
  "*": "deny",
  [path.join(".opencode", "data", "memory", "*_orchestrator.md")]: "allow",
  [path.join("plans", "*")]: "allow",
},
```

**`write`**: Change from simple `"deny"` to an object allowing `plans/*`:
```ts
write: {
  "*": "deny",
  [path.join("plans", "*")]: "allow",
},
```

**`task`**: Change from `"deny"` to `"allow"`:
```ts
task: "allow",
```

### 2. Prompt changes (orchestrator.txt)

- Remove lines saying "you NEVER edit plan files directly"
- Remove lines saying "you do NOT edit plan files (you instruct main session to do it)"
- Update instruction format to show orchestrator CAN edit plans directly
- Update "What You Do NOT Do" section to reflect new capabilities
- Add guidance on delegating source-work to sub-agents via `task` tool

## Formalization

```
Let P = { orchestrator permission ruleset }
Let R = { capabilities: edit, write, task, todowrite, bash, read, ... }
Let F = { restriction: read-only-file-system }

Before: P(edit) = { *: deny, memory: allow } 
        P(write) = { *: deny }
        P(task) = { *: deny }
        Prompt says: "NEVER edit plan files, NEVER call task"

After:  P(edit) = { *: deny, memory: allow, plans: allow }
        P(write) = { *: deny, plans: allow }
        P(task) = { *: allow }
        Prompt says: "Edit plan files directly, delegate to sub-agents via task"
```

## Structural Diagram

```
Before:
orchestrator → [read-only] → reads plans → instructs main session to edit/move them

After:
orchestrator → [read + plan-edit + task] → reads/edits/creates plans directly
                                          → delegates source-work to sub-agents
                                          → reads codebase still read-only
```

## Tasks

- [x] 1.1 Edit `agent.ts` orchestrator permission block — change `edit`, `write`, `task` rules
- [x] 1.2 Edit `orchestrator.txt` prompt — remove plan-edit restrictions, add delegation guidance
- [x] 1.3 Run `bun typecheck` from `packages/opencode`
- [x] 1.4 Permission rules verified: `edit` allows `plans/*`, `write` allows `plans/*`, `task` = `allow`. Typecheck passes. See `agent.ts:153-163`.

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Typecheck passes | `bun typecheck` exit 0 |
| 2 | Orchestrator `edit` denied for source files | Runtime `DeniedError` for `edit src/session/system.ts` |
| 3 | Orchestrator `edit` allowed for plan files | No `DeniedError` for `edit plans/*.md` |
| 4 | Orchestrator `write` allowed for plan files | No `DeniedError` for `write plans/new_plan.md` |
| 5 | Orchestrator `task` allowed | No `DeniedError` for `task ...` |
| 6 | Orchestrator `todowrite` remains denied | `DeniedError` for `todowrite ...` |

## Risk Assessment

- **LOW**: Prompt change + permission change are self-contained in 2 files. Typecheck must pass.
- **LOW**: The orchestrator could theoretically `edit` or `write` to paths matching `plans/*` that are NOT plan files (e.g., `plans/../src/session/system.ts`). The `Wildcard.match` function is not path-traversal-safe. Mitigation: documented in code comment as a known limitation. The `plan` agent has the same `plans/*.md` pattern — if it were a real concern, it would already be a bug.
