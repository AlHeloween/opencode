# AGI Flow Bugs — Emergency Fix Plan

**Created**: 2026-06-25T11:40  
**Scope**: Bugs found in `agi-mode.tsx` + `session/index.tsx` merged-messages display  
**Priority**: Emergency (B6 is functional bug)

---

## Bug B6: Wrong sessionID for orchestrator message dialogs [MEDIUM]

**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`  
**Line**: 1221  
**Issue**: `DialogMessage` receives `sessionID={route.sessionID}` for ALL messages, including orchestrator ones. Clicking an orch message opens dialog targeting the main TUI session, not the orchestrator session. Message parts display correctly (looked up by global `message.id`), but session-level operations (reply, etc.) target wrong session.

**Fix**: When `_source === "orch"`, pass `agi.orchSessionID()` instead of `route.sessionID`.

**Math**: `sessionID = msg._source === "orch" ? orchSessionID : route.sessionID`

**Test**: Verify DialogMessage opens with correct sessionID for both main and orch messages.

---

## Bug B3: setTimeout leak — no cleanup on deactivation [MEDIUM]

**File**: `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`  
**Lines**: 138, 154  
**Issue**: `setTimeout(..., 1000)` callbacks persist after deactivation. Callbacks check `oid()`/`mid()` → return early when undefined (safe), but timer resources leak and callbacks execute unnecessarily.

**Fix**: Track timer IDs with `let orchTimer: ReturnType<typeof setTimeout>` and `let mainTimer: ReturnType<typeof setTimeout>`. Clear both in `deactivate()`.

**Math**: 
```
deactivate() {
    clearTimeout(orchTimer)
    clearTimeout(mainTimer)
    // ... existing cleanup ...
}
```

**Test**: Activate AGI mode → immediately deactivate → verify no spurious message sends.

---

## Bug B7: Revert filter hides orchestrator messages [LOW]

**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`  
**Line**: 1210-1212  
**Issue**: Revert filter `message.id >= revertID` applies globally, hiding orch messages with later ULIDs.

**Fix**: Add condition `message._source !== "orch"` to the revert filter.

```
<Match when={revert()?.messageID && message.id >= revert()!.messageID && (message as any)._source !== "orch"}>
```

**Test**: Activate AGI mode → let orch send messages → revert in main → verify orch messages still visible.

---

## Incomplete I1: Auto-compact orchestrator on threshold [LOW]

**File**: `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`  
**Lines**: 270-276  
**Issue**: `compactOrchestrator()` exists but is never triggered automatically.

**Fix**: In `createEffect` auto-continue loop (line 154 area), after every N turns or when orch message count exceeds threshold, call `compactOrchestrator()`.

**Math**: `if (turnCount % 5 === 0) await compactOrchestrator()`

**Test**: Let AGI mode run 5+ turns → verify orchestrator context is compacted.

---

## Bug B4: Double toast on activation failure [MINOR]

**File**: `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`  
**Lines**: 247-251  
**Issue**: Error toast (249) + `deactivate()` shows "AGI mode deactivated" (185) = two toasts for one failure.

**Fix**: Add `silent` param to `deactivate()` or skip the error toast when already showing failure toast.

**Test**: Trigger activation failure → verify only one toast appears.

---

## Task Checklist

- [x] B6: Fix wrong sessionID for orchestrator message dialogs
- [x] B3: Clear setTimeout timers on deactivate
- [x] B7: Exclude orch messages from revert filter
- [x] I1: Auto-compact orchestrator every N turns
- [x] B4: Fix double toast on activation failure
- [x] Typecheck: `bun typecheck` from `packages/opencode/`
- [ ] Build: `pwsh _build.ps1`
