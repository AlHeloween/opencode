# Fix: Unified Agent Model Resolution

**Created**: 2026-08-24  
**Status**: DRAFT  
**Depends on**: analysis in `2026-08-24_model-inheritance-analysis.md`  
**Owner**: Smit

---

## Problem Statement

Model selection for agents is resolved inconsistently across 5+ code paths:

| Code path | Session | Workspace | Global | Legacy | Parent |
|-----------|---------|-----------|--------|--------|--------|
| TUI display (`local.tsx`) | ✅ | ✅ | ✅ | — | — |
| TUI submit (`prompt/index.tsx`) | — | — | — | — | — (passes `model.current()`) |
| Backend prompt (`prompt.ts:1149`) | — | — | ✅ only | ✅ | — |
| task() (`task.ts:244-261`) | ⚠ parent | ✅ | ✅ | ✅ | ✅ |
| pipeline() (`pipeline.ts:206`) | ❌ | ❌ | ✅ only | ✅ | — |
| plan transition (`plan.ts:36-53`) | ⚠ current | — | ✅ | — | — |
| reasoning transition (`reasoning.ts:30-47`) | ⚠ current | — | ✅ | — | — |

**Result**: TUI shows correct model, runtime uses different one.

---

## Abstract Definition

### Model Resolution Function

```
resolveAgentModel(agentName: string, context: ResolutionContext): ResolvedModel

ResolutionContext = {
  sessionID: SessionID,       // current or parent session
  workspaceID?: string,       // workspace scope for workspaceAgent lookup
}

Resolution order (highest priority first):
  1. Session override    — sessionSettings.agent[agentName].model
  2. Workspace selection — workspaceAgentModel(agentName, workspaceID, modelState)  
  3. Global agent config — agentInfo.model (from opencode.jsonc)
  4. Legacy task model   — modelState.taskModel (backward compat)
  5. Caller's model      — parent model (for sub-agents only)
  6. Provider default    — provider.defaultModel()

Returns: { providerID, modelID, variant? }
```

### Variant Resolution Function

```
resolveAgentVariant(agentName: string, model: ModelRef, context: ResolutionContext): string | undefined

Resolution order:
  1. Session agentVariant  — settings.agentVariant["agentName/providerID/modelID"]
  2. Session agent variant — settings.agent[agentName].variant
  3. Session model variant — settings.variant["providerID/modelID"]
  4. Workspace agentVariant — modelStore.agentVariant["agentName/providerID/modelID"]
  5. Workspace variant     — modelStore.variant["providerID/modelID"]
  6. Agent configured      — agentInfo.variant (only if same model as configured)
```

---

## Implementation Plan

### Task 1: Create `resolveAgentModel()` in session-settings.ts

**File**: `packages/opencode/src/session/session-settings.ts`

Add unified resolution function that encapsulates the full chain:

```typescript
export interface ModelResolutionContext {
  sessionID: SessionID
  workspaceID?: string
}

export async function resolveAgentModel(
  agentName: string,
  context: ModelResolutionContext,
  opts?: {
    /** For sub-agents: the caller's current model as final fallback */
    callerModel?: ModelRef
    /** Skip session lookup (for fresh sessions with no settings file) */
    skipSession?: boolean
  }
): Promise<ModelRef | undefined> {
  // 1. Session override
  if (!opts?.skipSession) {
    const settings = await loadSessionSettings(context.sessionID)
    const sessionModel = sessionAgentModel(agentName, settings)
    if (sessionModel) return sessionModel
  }
  
  // 2. Workspace selection
  const modelState = await readModelState()  // reads model.json
  const workspaceModel = workspaceAgentModel(agentName, context.workspaceID, modelState)
  if (workspaceModel) return workspaceModel
  
  // 3. Global agent config — caller must provide Agent.Info
  // (not read here — caller passes agent.model)
  
  return undefined  // caller falls through to global/default
}

export async function resolveAgentVariant(
  agentName: string,
  model: ModelRef,
  context: ModelResolutionContext
): Promise<string | undefined> {
  const settings = await loadSessionSettings(context.sessionID)
  return sessionAgentVariant(agentName, model, settings)
}
```

**Key design**: The function returns `undefined` when no session/workspace override exists, letting the caller fall through to global config. This preserves backward compatibility.

**Tests**: `prompts_kernel/tests/` or new test file for session-settings.

### Task 2: Fix `pipeline.ts` — Use unified resolution

**File**: `packages/opencode/src/tool/pipeline.ts:200-206`

**Before**:
```typescript
const defaultModel = yield* provider.defaultModel()
const model = stepAgent.model ?? defaultModel
```

**After**:
```typescript
import { resolveAgentModel } from "@/session/session-settings"

// ... inside the loop:
const parentSession = yield* sessions.get(ctx.sessionID)
const resolved = yield* Effect.tryPromise({
  try: () => resolveAgentModel(stepAgent.name, {
    sessionID: ctx.sessionID,
    workspaceID: parentSession.workspaceID,
  }, {
    callerModel: stepAgent.model ? Provider.parseModel(stepAgent.model) : undefined,
  }),
  catch: (e) => e,
}).pipe(Effect.catch(() => Effect.succeed(undefined)))

const defaultModel = yield* provider.defaultModel()
const model = resolved
  ?? stepAgent.model  // global agent config
  ?? defaultModel
```

Also resolve variant:
```typescript
const resolvedVariant = yield* Effect.tryPromise({
  try: () => resolveAgentVariant(stepAgent.name, model, {
    sessionID: ctx.sessionID,
    workspaceID: parentSession.workspaceID,
  }),
  catch: (e) => e,
}).pipe(Effect.catch(() => Effect.succeed(undefined)))
```

### Task 3: Fix `task.ts` — Align with unified resolution

**File**: `packages/opencode/src/tool/task.ts:231-261`

**Current** (simplified):
```typescript
const sessionModel = sessionAgentModel(next.name, sessionSettings)
const model = sessionModel ?? workspaceModel ?? next.model ?? taskModelOverride ?? parentModel
```

**After** (use unified function):
```typescript
import { resolveAgentModel, resolveAgentVariant } from "@/session/session-settings"

const resolved = yield* Effect.tryPromise({
  try: () => resolveAgentModel(next.name, {
    sessionID: ctx.sessionID,
    workspaceID: parentSession.workspaceID,
  }, {
    callerModel: { providerID: msg.info.providerID, modelID: msg.info.modelID },
  }),
  catch: (e) => e,
}).pipe(Effect.catch(() => Effect.succeed(undefined)))

const model = resolved
  ?? next.model  // global agent config
  ?? taskModelOverride
  ?? { modelID: msg.info.modelID, providerID: msg.info.providerID }
```

Remove the manual `sessionAgentModel` / `workspaceAgentModel` / `taskModelOverride` chain — unified function handles it.

### Task 4: Fix `plan.ts` and `reasoning.ts` — Align transition resolution

**File**: `packages/opencode/src/tool/plan.ts:36-53`  
**File**: `packages/opencode/src/tool/reasoning.ts:30-47`

Both use `transitionModel()`. Refactor to use unified resolution:

```typescript
import { resolveAgentModel, resolveAgentVariant } from "@/session/session-settings"

async function transitionModel(
  agentName: string,
  target: Agent.Info | undefined,
  settings: SessionSettings | null,
  fallback: ModelRef & { variant?: string },
  context: { sessionID: SessionID; workspaceID?: string }
) {
  const resolved = await resolveAgentModel(agentName, context)
  const model = resolved ?? target?.model ?? fallback
  const variant = await resolveAgentVariant(agentName, model, context)
    ?? (target?.model?.providerID === model.providerID && target?.model?.modelID === model.modelID
      ? target?.variant : undefined)
    ?? fallback.variant
  return {
    providerID: ProviderID.make(model.providerID),
    modelID: ModelID.make(model.modelID),
    ...(variant ? { variant } : {}),
  }
}
```

### Task 5: Fix `prompt.ts` fallback chain

**File**: `packages/opencode/src/session/prompt.ts:1149`

**Before**:
```typescript
const model = input.model ?? ag.model ?? (yield* lastModel(input.sessionID))
```

**After**:
```typescript
// Try workspace/session before falling to global agent config
const resolvedFromSettings = yield* Effect.tryPromise({
  try: () => resolveAgentModel(ag.name, {
    sessionID: input.sessionID,
    workspaceID: session.workspaceID,
  }),
  catch: (e) => e,
}).pipe(Effect.catch(() => Effect.succeed(undefined)))

const model = input.model ?? resolvedFromSettings ?? ag.model ?? (yield* lastModel(input.sessionID))
```

Note: `input.model` is always set by TUI submit, so this fallback rarely triggers. But it fixes the edge case.

### Task 6: Fix legacy `build` → `build_mode` in tests

**Files**: All test files using `agent: "build"` or `mode: "build"`

Replace:
```typescript
agent: "build"  →  agent: "build_mode"
mode: "build"   →  mode: "build_mode"
```

This is a large but mechanical change. The `canonicalIdentity()` function already handles the alias, but tests should use canonical names for clarity.

---

## Input / Output Parameters

### Input
- Current session ID
- Target agent name  
- Workspace ID (from session.workspaceID)
- Model state (from model.json)
- Session settings (from sessions/{id}.jsonc)
- Global agent config (from Agent.Service.get())

### Output
- Resolved model: `{ providerID: string, modelID: string }`
- Resolved variant: `string | undefined`

---

## Test Cases

### TC1: Session override wins
- Session settings: `explorer_agent → claude-haiku`
- Workspace: `explorer_agent → gpt-4o`
- Global: `explorer_agent → gemini-pro`
- **Expected**: `claude-haiku`

### TC2: Workspace wins over global
- No session override
- Workspace: `explorer_agent → gpt-4o`
- Global: `explorer_agent → gemini-pro`
- **Expected**: `gpt-4o`

### TC3: Global wins over default
- No session override, no workspace
- Global: `explorer_agent → gemini-pro`
- **Expected**: `gemini-pro`

### TC4: Sub-agent inherits from parent session
- Parent session settings: `explorer_agent → claude-haiku`
- task(explorer_agent) from parent
- **Expected**: `claude-haiku` (from parent session settings)

### TC5: Pipeline uses correct model
- Session settings: `explorer_agent → claude-haiku`
- pipeline([{agent: "explorer_agent", ...}])
- **Expected**: `claude-haiku` (NOT global config)

### TC6: Mode transition uses correct model
- Session settings: `plan_mode → claude-haiku`
- Switch build_mode → plan_mode
- **Expected**: `claude-haiku`

### TC7: Cross-session isolation
- Session A: `plan_mode → claude-haiku`
- Session B: `plan_mode → gpt-4o`
- Task from A → plan_mode
- **Expected**: `claude-haiku` (A's choice, not B's)

### TC8: Fresh session falls to workspace
- No session settings (new session)
- Workspace: `explorer_agent → gpt-4o`
- **Expected**: `gpt-4o`

### TC9: No overrides falls to global
- No session settings, no workspace
- Global: `explorer_agent → gemini-pro`
- **Expected**: `gemini-pro`

---

## Blast Radius

- `packages/opencode/src/session/session-settings.ts` — new functions (additive)
- `packages/opencode/src/tool/pipeline.ts` — model resolution change
- `packages/opencode/src/tool/task.ts` — model resolution refactor
- `packages/opencode/src/tool/plan.ts` — transition model refactor
- `packages/opencode/src/tool/reasoning.ts` — transition model refactor
- `packages/opencode/src/session/prompt.ts` — fallback chain improvement
- Test files — legacy alias cleanup

**Risk**: All changes preserve backward compatibility. Unified function returns `undefined` when no override exists, letting callers fall through to existing global/default logic.

---

## Prior Art

- `task.ts:244-261` — most complete existing implementation (5-level chain)
- `local.tsx:360-376` — TUI display chain (correct 3-level)
- `session-settings.ts` — existing `sessionAgentModel()`, `workspaceAgentModel()`, `sessionAgentVariant()`

---

## Smoke Tests

```bash
# Build
cd packages/opencode && bun typecheck

# Run existing tests
cd packages/opencode && bun test

# Manual verification:
# 1. TUI: open /agents → verify each agent shows correct model
# 2. TUI: switch agents → verify model changes correctly  
# 3. TUI: task(explorer_agent) → verify sub-agent uses correct model
# 4. Check logs for "task agent model differs from parent" messages
```
