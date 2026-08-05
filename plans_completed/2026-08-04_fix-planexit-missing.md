# Fix: planexit Not Available — Remove Experimental Gate

## Root Cause

`registry.ts:312`:
```tsx
...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []),
```

`Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE` reads from `config.experimental.planMode` which is not set → `undefined` → `planexit` never registered. Plan mode works but exit tool doesn't exist.

## Fix (1 change, 1 file)

**`src/tool/registry.ts:312`** — remove experimental gate:
```tsx
// BEFORE:
...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []),

// AFTER:
...(Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []),
```

**Also cleanup** (optional, separate commit):
- `config.ts:972` — `OPENCODE_EXPERIMENTAL_PLAN_MODE` declaration
- `config.ts:1151` — `"experimental.planMode"` config key
- Any other references to the flag

## Files

| File | Change |
|------|--------|
| `src/tool/registry.ts:312` | Remove `Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE &&` |

## Smoke Tests

1. Rebuild → `planexit` appears in tool list for plan agent
2. Call `planexit` → "Switch to build agent?" dialog appears
3. Click "Yes" → agent switches to "build"
4. Build mode: edits outside `plans/` are allowed

## Pending (separate plan)

After planexit works, implement `plans/fix-agent-dialog-flow.md`:
- `dialog-agent.tsx`: restore Enter→DialogModel + current prop
- `dialog-model.tsx`: add `local.agent.set(props.targetAgent)` after model selection
