# Agent Selection + Variant Unification Plan
> sv=[[agent, variant, reasoning-effort, dialog, task-model, unification, config],[0.22,0.20,0.18,0.15,0.12,0.08,0.05]]
> abstract="Unify agent selection into /agents dialog as single source of truth. Add per-agent variant (reasoning effort) display and cycling. Deprecate separate ctrl+x o task model override."

**Status:** Tasks 1-5 DONE (2026-06-27). Task 6 deferred.

## Problem

Two competing agent selection systems:
1. `/agents` (`<leader>a`) — configures primary agents with model + variant
2. `ctrl+x o` — overrides sub-agent model globally, **without variant support**

**Result:** Sub-agents (general, explore, coder, researcher) have no reasoning effort configuration.

## Solution

Make `/agents` the single source of truth for ALL agents (primary + subagent) with full model + variant configuration.

## Changes

### 1. dialog-agent.tsx — Add variant display + cycling
**File:** `packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx`

- Show current variant in agent row footer (e.g., "openai/gpt-5 · high")
- Add variant cycling keybind to agent dialog
- Update `buildOption()` to include variant info

### 2. local.tsx — Per-agent variant storage
**File:** `packages/opencode/src/cli/cmd/tui/context/local.tsx`

- Extend `modelStore.variant` to support per-agent keys: `agentName/providerID/modelID`
- Add `variant.forAgent(agentName)` method
- Update `variant.selected()`, `variant.list()`, `variant.set()`, `variant.cycle()` to be agent-aware

### 3. prompt/index.tsx — Use agent-aware variant
**File:** `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

- Update `const variant = local.model.variant.current()` to use current agent's variant
- Pass agent-specific variant to prompt submission

### 4. task.ts — Read agent-specific variant
**File:** `packages/opencode/src/tool/task.ts`

- When creating sub-agent task, read variant from agent config
- Pass variant to provider options

### 5. Deprecate ctrl+x o
**File:** `packages/opencode/src/cli/cmd/tui/app.tsx`

- Mark `task_model_list` as deprecated/hidden
- Or repurpose as quick-switch for current agent's model

## Implementation Order

1. [x] Extend local.tsx variant storage to be agent-aware
2. [x] Update dialog-agent.tsx with variant display + cycling
3. [x] Update prompt/index.tsx to use agent-aware variant
4. [x] Update task.ts to read variant from agent config
5. [x] Deprecate ctrl+x o keybind
6. [~] Test end-to-end flow (deferred to runtime testing)
