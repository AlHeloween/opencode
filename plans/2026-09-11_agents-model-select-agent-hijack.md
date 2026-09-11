# /agents model selection must not hijack the active agent

state: ACTIVE
scope: packages/opencode/src/cli/cmd/tui

## Problem

Configuring a model for agent X from the `/agents` dialog switches the MAIN
window to agent X (2026-09-11, Alexander: "она автоматом выбирается в основном
окне — это очень неудобно").

Root cause — `dialog-model.tsx:202`:

```ts
const agent = props.targetAgent ?? local.agent.current()?.name
local.model.set({ providerID, modelID }, { recent: true, agent, scope: props.scope })
if (agent && canActivateAgent(agent, sync.data.agent)) local.agent.set(agent)
```

Without `targetAgent` (the `/model` dialog) `agent === current` and the call is a
no-op. It only ever fires for the `/agents` path — i.e. exactly where it is wrong.
`canActivateAgent` (2026-08-31) already stopped SUBAGENTS from being activated;
primary agents (build_mode / plan_mode / orchestrator_agent / reasoning_mode)
still hijack the prompt.

The activation is a crutch: the follow-up variant step calls
`local.model.variant.list()` / `.selected()` and renders `<DialogVariant scope=...>`
with NO `targetAgent`, so it resolves against the ACTIVE agent. Making the target
active was what kept that path pointing at the right agent.

## Tasks

- [x] T1 `util/agent.ts`: add `shouldActivateAgent(target, explicitTarget, agents)`
      — an explicit target never activates; delegate to `canActivateAgent` otherwise.
- [x] T2 `dialog-model.tsx`: use it, and thread `agent` into `variant.list()`,
      `variant.selected()` and `<DialogVariant targetAgent=...>` so the variant
      step no longer depends on the activation side effect.
- [x] T3 `test/tui/agent-selection.test.ts`: lock the rule.

## Smoke Tests

- baseline: `bun test test/tui/agent-selection.test.ts` from `packages/opencode`
  → 2 pass / 0 fail (captured 2026-09-11, before the edit).
- post-change: same command → 3 pass / 0 fail, new case
  "configuring another agent's model does not change the active agent".
- `bun typecheck` from `packages/opencode`.
- TUI oracle: `/agents` → pick a non-active primary agent → set a model →
  the footer model line updates, the status bar agent stays put.

## Rollback

Single-hunk revert of `dialog-model.tsx` + drop `shouldActivateAgent`.
