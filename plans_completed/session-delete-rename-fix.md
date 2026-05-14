# Fix: Session Delete & Rename from TUI

## Problem
Cannot delete or rename sessions from the TUI. Actions produce errors/crashes without completing the operation. This is a regression from the original codebase.

## Root Causes

### 1. `sync.tsx` — `session.updated` handler uses wrong lookup key (blocks rename)
`packages/opencode/src/cli/cmd/tui/context/sync.tsx:215`

```ts
// Wrong: info.id is optional in UpdatedInfo and may be undefined
const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
// Fix:
const result = Binary.search(store.session, event.properties.sessionID, (s) => s.id)
```

When renaming a session, `setTitle` emits a `session.updated` bus event with partial data: `{ title: "new title" }`. The `id` field is absent from this partial update. The handler fails to find the session, then inserts a corrupt partial entry into the store. This is the primary reason rename appears to have no effect — the title never updates in the UI, and the store becomes corrupted.

Also apply the same fix to `session.deleted` for consistency (`event.properties.sessionID` is always available while `info.id` depends on schema).

### 2. `dialog-session-list.tsx` — delete logic outside try/catch (potential crash)
`packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx:230-235`

```ts
} catch (err) { ... return }
// These are OUTSIDE try/catch — unhandled rejection if refresh() throws
sync.set("session", (draft) => draft.filter((s) => s.id !== option.value))
await sync.session.refresh()
if (search()) await refetch()
```

If `sync.session.refresh()` fails, the rejected promise propagates up unhandled because `DialogSelect` does not `await` the `onTrigger` callback. Move this block inside the try.

### 3. `dialog-session-rename.tsx` — fire-and-forget, no error handling (silent failure)
`packages/opencode/src/cli/cmd/tui/component/dialog-session-rename.tsx:22-26`

```ts
// Wrong: void discards promise, no error feedback, no sync update
void sdk.client.session.update({ sessionID, title: value })
dialog.clear()
```

The update API call is fire-and-forget. Any failure is silent, and the dialog closes regardless. Combined with issue 1, the user sees nothing happen. Fix by awaiting, catching errors, and updating the local sync store.

## Changes

### File 1: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- **Line 203**: Change `event.properties.info.id` → `event.properties.sessionID` in `session.deleted` handler
- **Line 215**: Change `event.properties.info.id` → `event.properties.sessionID` in `session.updated` handler

### File 2: `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx`
- Move `sync.set(...)`, `await sync.session.refresh()`, `await refetch()`, `setToDelete(undefined)` inside the try block (after confirming `result.error` is falsy)
- Remove the redundant `setToDelete(undefined)` from catch/finally (already handled inside try)

### File 3: `packages/opencode/src/cli/cmd/tui/component/dialog-session-rename.tsx`
- Make `onConfirm` async, await `sdk.client.session.update()`, handle errors with toast
- After successful rename, update the local sync store via `sync.session.refresh()` before closing dialog

## Verification
1. After fix, verify `bun typecheck` passes in `packages/opencode`
2. Manual test: open TUI, rename a session with `ctrl+r`, verify title updates in session list
3. Manual test: delete a session with `ctrl+d` (confirm), verify it disappears from list
