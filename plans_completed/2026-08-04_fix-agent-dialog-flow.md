# Fix: Agent Dialog Flow — Restore Switching + Model Picker

## Root Cause

The rich Agent Configuration dialog (`d4e0aa53a7`) **never switched agents**.  
The old simple dialog (pre-`d4e0aa53a7`) had `local.agent.set()` in `onSelect`.  
The rich dialog replaced it with `dialog.replace(DialogModel)` — model picker opened,  
but after model selection, `local.agent.set()` was **never called**.

## What the user expects

1. Open `/agents` → see agent list with active agent highlighted
2. **Enter on agent** → model picker form appears (select model for that agent)
3. **Select model** → agent switches to the selected one + returns to agent list
4. Active agent is visually indicated (highlight + "← active" label)

## Changes

### 1. `dialog-agent.tsx` — RESTORE Enter→model picker + current prop

**`buildOption.onSelect`** (line 181-185):
```tsx
// CURRENT (broken — skips model picker):
onSelect: () => {
  local.agent.set(agent.name)
  dialog.clear()
},

// FIX (restore model picker flow):
onSelect: () => {
  dialog.replace(() => (
    <DialogModel
      targetAgent={agent.name}
      onDone={() => dialog.replace(() => <DialogAgent />)}
    />
  ))
},
```

**`DialogSelect` props** — add `current`:
```tsx
<DialogSelect
  title="Agent Configuration"
  current={local.agent.current()?.name}    // ← ADD: highlights active agent
  options={options()}
  ...
/>
```

**KEEP** `isActive` + `activeLabel` for "← active" footer label.

### 2. `dialog-model.tsx` — ADD agent switching after model selection

**`onSelect` function** (line 135), add after `local.model.set(...)`:
```tsx
function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true, agent: props.targetAgent })
    
    // NEW: switch to target agent after model selection
    if (props.targetAgent) {
      local.agent.set(props.targetAgent)
    }
    
    // ... rest unchanged (variant check → onDone/dialog.clear/DialogVariant)
}
```

### 3. `local.tsx` — KEEP existing fixes (already committed)

- `agent.current()` — respects `default_agent` config
- `currentModel()` — uses `forAgent(a.name)` (session settings → global config)

## Flow after fix

```
/agents → DialogAgent (list with ★ current + "← active")
  ↓ Enter on agent "plan"
  DialogModel (targetAgent="plan", select model)
  ↓ Select model "claude-sonnet-4"
  local.model.set({...}, {agent:"plan"})  // set model for agent "plan"
  local.agent.set("plan")                  // NEW: switch active agent
  onDone() → DialogAgent (re-rendered, now shows "plan" as ★ current)
```

## Files modified

| File | Lines | What |
|------|-------|------|
| `dialog-agent.tsx` | 181-185 | Restore `dialog.replace(DialogModel...)` in `onSelect` |
| `dialog-agent.tsx` | 190-192 | Add `current={local.agent.current()?.name}` |
| `dialog-model.tsx` | 136-139 | Add `local.agent.set(props.targetAgent)` after `model.set` |

## Smoke Tests

1. Open TUI, run `/agents` — dialog appears with agent list
2. Active agent shows `●` (DialogSelect current) + "← active" in footer
3. Press Enter on a different agent → model picker opens
4. Select a model → dialog returns to agent list, **new agent is now active**
5. Verify agent changed: Tab indicator / prompt prefix shows new agent name
6. "Change model" keybind still works
7. `default_agent` config respected on fresh TUI start
