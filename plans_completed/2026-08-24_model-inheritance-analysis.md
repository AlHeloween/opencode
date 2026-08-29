# Model Inheritance for Agents — Deep Analysis

**Created**: 2026-08-24  
**Status**: ANALYSIS (pending implementation)  
**Problem**: Model selection for agents is chaotic — TUI shows correct values, but runtime uses different ones. Mode switches and sub-agent delegation resolve unexpected models.

---

## Storage Layers

| Layer | Scope | File | Read by |
|-------|-------|------|---------|
| **Global config** | Per-install | `opencode.jsonc` → `agent[name].model` | `Agent.Service` (agent.ts:468) |
| **Workspace state** | Per-worktree (all sessions share) | `.opencode/data/state/model.json` → `workspaceAgent[scope][agentName]` | `workspaceAgentModel()` |
| **Session settings** | Per-session | `.opencode/data/sessions/{sessionID}.jsonc` → `agent[name].model` | `sessionAgentModel()` |
| **Legacy task model** | Per-worktree | `.opencode/data/state/model.json` → `taskModel` | `task.ts:235` |

### Data flow on user model selection (TUI DialogModel)

```
DialogModel.onSelect()
  → local.model.set({providerID, modelID}, {recent: true, agent: agentName})
    → modelStore.workspaceAgent[scope][agentName] = {providerID, modelID}  (workspace — global)
    → sessionSettings.agent[agentName].model = "providerID/modelID"         (session-local)
    → model.json (recent, favorite, variant, agentVariant, workspaceAgent, taskModel)
```

**Key observation**: Both workspace AND session settings are written on explicit selection. Workspace is shared across all sessions in the worktree.

---

## Resolution Chains — Complete Map

### Chain 1: TUI Display (`local.tsx` → `forAgent(name)`)

What the user SEES in `/agents` dialog:

```
1. sessionSettings.agent[name].model     ← per-session override
2. workspaceAgentModel(name, workspace)  ← last explicit selection in this worktree  
3. sync.data.agent[name].model           ← global config from opencode.jsonc
```

Used by: `currentModel()`, TUI model display, `/agents` dialog.

### Chain 2: TUI Submit (`prompt/index.tsx` → `submit()`)

What the user SENDS when pressing Enter:

```
selectedModel = local.model.current()    ← same chain as #1
→ sdk.client.session.prompt({ model: selectedModel, agent: agent.name, ... })
```

### Chain 3: Backend Prompt — User Message Creation (`prompt.ts:1149`)

```
input.model        ← from TUI (Chain 2) — SHOULD be the correct model
  ?? agent.model   ← GLOBAL agent config (NOT workspace/session!)
  ?? lastModel()   ← last user message from DB, else provider.defaultModel()
```

**⚠ ISSUE**: The `?? agent.model` fallback uses the **global** agent config, not the workspace or session override. If `input.model` is somehow missing, the global config is used instead of the workspace/session chain.

### Chain 4: Backend Prompt — LLM Call (`prompt.ts:1807`)

```
lastUser.model     ← stored in DB from Chain 3 user message creation
→ getModel(lastUser.model.providerID, lastUser.model.modelID)
```

This reads from the DB message — whatever Chain 3 stored. If Chain 3 resolved correctly, this is correct.

### Chain 5: task() Sub-agent Model Resolution (`task.ts:244-261`)

When the agent calls `task()` to spawn a sub-agent:

```
1. sessionAgentModel(targetAgentName, PARENT's session settings)
   ⚠ loads PARENT session's file, not target agent's own session
2. workspaceAgentModel(targetAgentName, parentSession.workspaceID)
3. targetAgent.model (global agent config)
4. taskModelOverride (model.json taskModel)
5. parentModel (msg.info.modelID/providerID — the PARENT's current model)
```

**⚠ CRITICAL BUG**: Step 1 loads the parent session's settings file. If the user configured `explorer_agent` model in Session A, that override lives in Session A's file. When a DIFFERENT parent session (Session B) spawns `explorer_agent`, Session B's file is read — which has NO override for `explorer_agent`. Falls to step 2 (workspace) or step 3 (global).

### Chain 6: pipeline() Sub-agent Model Resolution (`pipeline.ts:206`)

```
stepAgent.model ?? defaultModel
```

**⚠ BUG**: Only checks global agent config + default. Completely ignores:
- Session settings
- Workspace agent model
- Parent model

Compared to task.ts which checks 5 levels, pipeline.ts checks only 1 level.

### Chain 7: Mode Transition — plan_enter/plan_exit (`plan.ts:36-53`)

When switching between `build_mode` ↔ `plan_mode`:

```
transitionModel(targetAgentName, targetAgent, settings, fallback):
  1. sessionAgentModel(targetAgentName, CURRENT session settings)
  2. targetAgent.model (global agent config)
  3. fallback (lastModel from DB)
```

Same issue as Chain 5: reads CURRENT session's settings for the TARGET agent. If the target agent was configured in a different session, the override is missed.

### Chain 8: Mode Transition — reasoning_enter/exit (`reasoning.ts:30-47`)

```
transitionModel("reasoning_mode", targetAgent, settings, fallback):
  1. sessionAgentModel("reasoning_mode", CURRENT session settings)
  2. reasoningAgent.model (global agent config)
  3. fallback (lastModel from DB)
```

Same issue as Chain 7.

---

## Identified Bugs

### BUG 1: `pipeline.ts` — No session/workspace model resolution

**File**: `packages/opencode/src/tool/pipeline.ts:206`  
**Impact**: Pipeline sub-agents ALWAYS use global config or default model.  
**Current**:
```typescript
const model = stepAgent.model ?? defaultModel
```
**Expected**: Same 5-level chain as `task.ts`.  
**Severity**: HIGH — pipeline is a core orchestration tool.

### BUG 2: Cross-session workspace state pollution

**File**: `packages/opencode/src/cli/cmd/tui/context/local.tsx:537-539`  
**Impact**: Changing agent model in Session A overwrites workspace state that Session B reads.  
**Scenario**:
1. Session A: set `plan_mode` → `claude-haiku`
2. Session B: set `plan_mode` → `gpt-4o`  
3. Session A reopens: `forAgent("plan_mode")` → reads workspace → gets `gpt-4o` (Session B's choice!)
4. Session A: sessionSettings has `claude-haiku` → session wins (correct for A)
5. But task.ts spawning from A → workspace check returns `gpt-4o` (wrong)

**Severity**: MEDIUM — only affects multi-session scenarios.

### BUG 3: Session settings scope mismatch in task.ts

**File**: `packages/opencode/src/tool/task.ts:165-176`  
**Impact**: Sub-agent model resolution reads parent session's settings, not the target agent's session.  
**Expected**: When spawning a sub-agent, the parent session should be the source of truth. But the current code reads `sessionSettings.agent[targetAgentName]` from the parent's file — which may not have the target agent configured.

**The user's stated requirement**: "parent session was source of truth" — means when Session X spawns agent Y, Session X's model choice for Y should be used. The current code DOES try this (line 246), but the settings file is keyed by session ID, not by workspace. So each session gets its own overrides.

**Severity**: MEDIUM — affects first-use of sub-agents in new sessions.

### BUG 4: `prompt.ts:1149` fallback uses global config only

**File**: `packages/opencode/src/session/prompt.ts:1149`  
**Impact**: If `input.model` is somehow missing/undefined, the fallback is `agent.model` (global config), bypassing workspace/session chain entirely.  
**Current**:
```typescript
const model = input.model ?? ag.model ?? (yield* lastModel(input.sessionID))
```
**Expected**: Should check workspace/session chain before falling to global.  
**Severity**: LOW — only triggers when `input.model` is missing, which shouldn't happen in normal TUI flow.

### BUG 5: Variant resolution inconsistency across chains

Variant resolution in task.ts (line 267-278):
```
sessionAgentVariant(targetAgent, model, PARENT session settings)
  → modelStore.agentVariant[agentKey]
  → modelStore.variant[modelKey]
  → targetAgent.variant (only if same as configured model)
```

But in TUI `variant.selected()` (local.tsx:592-604):
```
modelStore.agentVariant[key]
  → sessionAgentVariant(agentKey, m, sessionSettings())
  → modelStore.variant[key]
```

The **order** differs: TUI checks `modelStore.agentVariant` first, then session. Runtime checks session first, then `modelStore.agentVariant`. If they differ, the displayed variant ≠ used variant.

**Severity**: LOW — affects variant selection only.

---

## Correct Model (Expected Resolution Order)

Per the user's requirement: **global → workspace → session (parent is source of truth)**

```
1. Session override (parent session's settings for this agent)
2. Workspace state (last explicit selection in this worktree)
3. Global agent config (opencode.jsonc)
4. Legacy task model / parent model (fallbacks)
```

**What exists**:
- TUI display: ✅ Correct (session → workspace → global)
- TUI submit: ✅ Correct (same chain)
- Backend prompt: ⚠ Uses `input.model` (correct) but fallback is global only
- task() sub-agent: ⚠ Session scope is parent's, which may not have target agent
- pipeline(): ❌ Only global config
- Mode transitions: ⚠ Session scope may miss target agent

---

## Recommendations

### Fix 1: `pipeline.ts` — Add full model resolution chain

```typescript
// Before (pipeline.ts:205-206):
const defaultModel = yield* provider.defaultModel()
const model = stepAgent.model ?? defaultModel

// After:
const sessionSettings = yield* loadSessionSettings(ctx.sessionID)
const modelState = yield* appFs.readJson(path.join(Global.Path.state, "model.json"))
  .pipe(Effect.catch(() => Effect.succeed(undefined)))
const parentSession = yield* sessions.get(ctx.sessionID)
const sessionModel = sessionAgentModel(stepAgent.name, sessionSettings)
const workspaceModel = workspaceAgentModel(stepAgent.name, parentSession.workspaceID, modelState)
const model = sessionModel
  ? { providerID: ProviderID.make(sessionModel.providerID), modelID: ModelID.make(sessionModel.modelID) }
  : workspaceModel
    ? { providerID: ProviderID.make(workspaceModel.providerID), modelID: ModelID.make(workspaceModel.modelID) }
    : (stepAgent.model ?? (yield* provider.defaultModel()))
```

### Fix 2: Consider workspace-scoped session settings

Current session settings are per-session-ID. For "parent session is source of truth" semantics, consider workspace-scoped overrides where the workspace remembers which agent has which model, and new sessions inherit the workspace choice (not a stale session-specific one).

### Fix 3: Align variant resolution order

Ensure all resolution paths use the same priority order:
```
sessionAgentVariant → modelStore.agentVariant → modelStore.variant → agent.variant
```

---

## Files to Modify

| File | Line(s) | Fix |
|------|---------|-----|
| `packages/opencode/src/tool/pipeline.ts` | 205-206 | Add session/workspace model resolution |
| `packages/opencode/src/session/prompt.ts` | 1149 | (optional) Add workspace fallback before global |
| `packages/opencode/src/tool/task.ts` | 244-261 | (review) Session scope semantics |
| `packages/opencode/src/tool/plan.ts` | 36-53 | (review) Session scope for mode transitions |
| `packages/opencode/src/tool/reasoning.ts` | 30-47 | (review) Session scope for mode transitions |

---

## Smoke Tests

```bash
# 1. Verify TUI shows correct model per agent
#    Open /agents → each agent should show its configured model

# 2. Verify mode switch uses correct model
#    In build_mode with model A → switch to plan_mode → should use plan_mode's model

# 3. Verify task() sub-agent inherits correctly
#    From build_mode (model A) → task(explorer_agent) → should use explorer's configured model

# 4. Verify pipeline sub-agent uses correct model
#    pipeline([{agent: "explorer_agent", ...}]) → should use explorer's model

# 5. Cross-session isolation
#    Session A: plan_mode → claude-haiku
#    Session B: plan_mode → gpt-4o
#    Verify each session uses its own selection
```
