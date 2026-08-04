# Fix: Ctrl+X + U (Undo) Silent Failure

## Problem

The undo keybind (`Ctrl+X + U`) appears to do nothing. Root cause: the `sdk.client.session.revert()` call uses the default `throwOnError: false`, so API errors resolve (not reject) — the `.then(() => toBottom())` fires regardless of success. Additionally, there are missing error handlers and null guards.

## Files to Modify

- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — undo handler (lines 672-700) and redo handler (lines 711-728)

## Changes

### 1. Fix undo handler (lines 672-700)

Current code (broken):
```ts
onSelect: async (dialog) => {
  const status = sync.data.session_status?.[route.sessionID]
  if (status?.type !== "idle") await sdk.client.session.abort({ ... }).catch(...)
  const revert = session()?.revert?.messageID
  const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
  if (!message) return  // ← silent no-op
  void sdk.client.session.revert({ sessionID, messageID })  // ← void-ed, no throwOnError
    .then(() => { toBottom() })  // ← fires even on error
  const parts = sync.data.part[message.id]  // ← could be undefined
  prompt?.set(parts.reduce(...))  // ← would crash if parts undefined
  dialog.clear()
}
```

Changes:
- Add `{ throwOnError: true }` to `sdk.client.session.revert()` call
- Replace `void ... .then()` with `await` + `.catch()` showing error toast
- Add toast feedback when `!message` (no user message found): `toast.show({ message: "No message to undo", variant: "info" })`
- Guard `sync.data.part[message.id]` against `undefined` before `.reduce()`

### 2. Fix redo handler (lines 711-728)

Same pattern:
- Add `{ throwOnError: true }` to `sdk.client.session.revert()` and `sdk.client.session.unrevert()` calls
- Add `.catch()` with error toast on both calls

## Verification

1. Build: `pwsh _build.ps1`
2. Run TUI: `cmd_runner start --cwd dist/bin -- opencode.exe`
3. Test undo: type a message, press Ctrl+X then U — message should be reverted and prompt restored
4. Test redo: press Ctrl+X then R — reverted message should be restored
5. Test edge case: press undo when no messages exist — should show toast
6. Run existing tests: `bun test keybind` from `packages/opencode`
