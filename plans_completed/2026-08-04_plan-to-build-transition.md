# Problem: Plan Mode → Build Mode Transition Failed

## Summary

During the `fix-agents-not-changing` plan, the agent was unable to exit plan mode and begin implementation. User approval was given verbally, but the system-level plan mode restriction remained active, blocking all source file edits.

## What Happened

1. Plan `fix-agents-not-changing.md` was written and approved by user
2. User said "Перейти в build mode" — verbal approval
3. Agent attempted `edit` on source files → **blocked** by permission rules
4. Agent tried `bun run planexit` → blocked (bun must go through cmd_runner)
5. Agent tried `cmd_runner start -- bun run planexit` → no such command exists
6. Agent asked user to toggle mode in UI → user said "Да"
7. Permission still blocked — mode wasn't actually toggled

## Root Cause

The plan/build mode toggle is controlled by the **system runtime**, not by conversation. There is:

- **No tool/API** for the agent to call `planexit` or toggle its own mode
- **No feedback mechanism** to confirm the mode actually switched
- **User verbal approval ≠ system state change** — the runtime mode flag is separate

The permission rules:
```
{"permission":"edit","pattern":"*","action":"deny"}
{"permission":"edit","pattern":"plans\\*","action":"allow"}
```
...remain active until the runtime explicitly switches to build mode.

## Resolution (workaround)

User manually switched mode via system UI. After that, edits succeeded.

## Proposed Fix (for the runtime)

1. **Expose a `planexit` tool** — the agent calls it to request mode transition after plan approval
2. **Auto-detect approval** — when user says "утвердить" / "перейти в build", the runtime could prompt for mode switch
3. **Better feedback** — if agent tries to edit non-plan files and is blocked, surface a clear message that plan mode is still active (not just a generic permission denied)
