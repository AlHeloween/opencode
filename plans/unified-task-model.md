# Unified Task Model Setting

## Problem

The subagent's TUI model selection via `<leader>o` is purely cosmetic.

- **TUI** (local.tsx): `model.set({ agent: "explore" })` stores in model.json → `agentModel.explore`
- **Backend** (task.ts:102): `const model = next.model ?? { modelID: msg.info.modelID, providerID: msg.info.providerID }`

`model.json`'s `agentModel` is **never read by the backend**. The TUI selection does not affect what model subagents actually use.

## Architecture

```
              opencode.jsonc              model.json
              agent.*.model               taskModel (NEW key)
                    │                        │
                    ▼                        ▼
            task.ts: ────────┬────────────────
                              │
                     resolution priority:
               agent config → taskModel → parent msg model
```

1. Agent config model from opencode.jsonc (highest priority, explicit user intent)
2. **taskModel** from model.json (TUI runtime override, applies to ALL subagents)
3. Parent message model (current default fallback)

## Implementation

### 1. local.tsx — Add taskModel to TUI store

**modelStore** (line 104): add `taskModel: { providerID: string; modelID: string } | undefined`

**Load** (line 149): add branch to read `x.taskModel`:
```ts
if (typeof x.taskModel === "object" && x.taskModel !== null
    && typeof x.taskModel.providerID === "string"
    && typeof x.taskModel.modelID === "string")
  setModelStore("taskModel", x.taskModel)
```

**Save** (line 141): add `taskModel: modelStore.taskModel` to written JSON.

**New methods** (around line 223 in returned object):
- `taskModel()` — returns modelStore.taskModel if valid, else undefined
- `taskSet(model)` — validates, sets modelStore.taskModel, calls save(). No `recent: true`.

### 2. dialog-explore-settings.tsx → dialog-task-settings.tsx

Replace explore-specific component with generic task dialog:

- Import: `local.model.taskModel()` and `local.model.taskSet()`
- `current`: reads `taskModel()`, falls back to explore agent config model from `sync.data.agent`
- Title: `"Task Agent — ${provider} / ${model}"`
- Options: `local.model.recent()` only (no full provider model list)
- On select: `local.model.taskSet({ providerID, modelID })`, then `dialog.clear()`

### 3. Delete dialog-explore-settings.tsx

Old file no longer needed. Component is replaced by dialog-task-settings.tsx.

### 4. app.tsx

- Import: `DialogExploreSettings` → `DialogTaskSettings`
- Command `explore.model.list` handler (line 455): `<DialogExploreSettings />` → `<DialogTaskSettings />`

### 5. task.ts — Backend reads taskModel

**New imports needed** (task.ts does NOT currently import these):
```ts
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
```

**Yield AppFileSystem.Service** in the Effect.gen block (available through registry layer).

Replace lines 102-105 with:
```ts
const fs = yield* AppFileSystem.Service
const taskOverride = yield* fs.readJson(path.join(Global.Path.state, "model.json")).pipe(
  Effect.map((x: any) => {
    if (x?.taskModel?.providerID && x?.taskModel?.modelID)
      return { providerID: x.taskModel.providerID, modelID: x.taskModel.modelID }
    return undefined
  }),
  Effect.catch(() => Effect.succeed(undefined)),
)
const model = next.model ?? taskOverride ?? {
  modelID: msg.info.modelID,
  providerID: msg.info.providerID,
}
```

Follows the existing pattern from provider.ts:1661 (reads model.json with `AppFileSystem.Service.readJson` + `Effect.catch`).

**Note:** `parseModel` (provider.ts:1714) is NOT used here — model.json stores plain strings. The JSON is parsed directly, same pattern as provider.ts:1661-1672.

## Files summary

| # | File | Action |
|---|------|--------|
| 1 | local.tsx | Add taskModel field + taskModel()/taskSet() + persist |
| 2 | dialog-task-settings.tsx | NEW — generic task agent dialog |
| 3 | dialog-explore-settings.tsx | DELETE — replaced by above |
| 4 | app.tsx | Update import + `<leader>o` handler |
| 5 | task.ts | Add imports + read taskModel from model.json |

## Isolation

- Build agent: untouched (task.ts only for subagents; build uses prompt.ts:901)
- model.json recent list: not polluted (no recent:true in taskSet)
- Existing opencode.jsonc agent configs: backward compatible (config > taskModel)
- Existing agentModel key: kept for TUI display, taskModel is sibling key
