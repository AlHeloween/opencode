# Bug Fixes Round 1 — Critical & High Severity

## Summary
Fix 10 critical/high severity bugs + 5 high-impact medium bugs found in codebase analysis.
**Validated by explore agent against actual codebase — corrections applied.**

## Current status
Implemented: Fixes 1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, and 15.
No code change needed: Fix 9.
Implemented 2025-05-14: Fix 13 fallback path now logs warnings (empty slug/version are correct defaults for sessions missing from per-project DB).
Still active: Fix 3 requires a higher-risk recursive session deletion batching redesign across session removal and sync/event sequencing.

---

## Fix 1: `SessionTable.parent_id` has NO FK constraint at all (not missing onDelete)
**File:** `packages/opencode/src/session/session.sql.ts:24`
**Validation:** CONFIRMED — `parent_id` is just `text("parent_id")`, no `.references()` call at all.
**Root cause:** Column is a plain text field with no foreign key constraint. Orphaned parent references are possible at the DB level.
**Fix:** ADD the FK reference with `onDelete: "set null"`:
```ts
// Before (line 24):
parent_id: text("parent_id"),
// After:
parent_id: text("parent_id").references((): AnySQLiteColumn => SessionTable.id, { onDelete: "set null" }),
```

## Fix 2: `PartTable.session_id` has NO FK reference at all
**File:** `packages/opencode/src/session/session.sql.ts:69`
**Validation:** CONFIRMED — `session_id` is `text("session_id").notNull()` with no `.references()`.
**Root cause:** No FK constraint on `PartTable.session_id`, same issue as Fix 1. Inconsistent with `MessageTable` which has the FK with cascade.
**Fix:** ADD the FK reference with `onDelete: "cascade"`:
```ts
// Before (line 69):
session_id: text("session_id").notNull(),
// After:
session_id: text("session_id").notNull().references(() => SessionTable.id, { onDelete: "cascade" }),
```

## Fix 3: `remove()` recursive deletion not in single transaction
**File:** `packages/opencode/src/session/session.ts:509-532`
**Root cause:** Each recursive `remove(child.id)` call runs its own independent `SyncEvent.run()` with separate transactions. If deletion fails partway, session tree is left inconsistent.
**Fix:** Check if we can wrap the recursive walk in a single `SyncEvent.run()` call by building all events upfront. Actually, the cleanest fix is to ensure each individual `SyncEvent.run` is atomic (they already are within their own scope), and add a `finally`/rollback note. The real issue is children are fetched before deletion — if child deletion fails, parent is still deleted but children are now orphaned. The fix should be:
1. Collect all child IDs recursively FIRST
2. Delete all in reverse order (deepest first) within a single `SyncEvent.run()`
```ts
// After collecting all descendant IDs:
// Delete all session events in one atomic batch
yield* SyncEvent.run(sessionID, "Session.removed", {
  sessionID,
  cascade: descendantIDs, // list of all children to also remove
})
```
The projector for `Session.removed` should handle cascading the delete to all listed children.

## Fix 4: Transaction effects execute after commit, breaking atomicity
**File:** `packages/opencode/src/storage/db.ts:609-638`
**Root cause:** Effects collected during transaction callback are executed AFTER the transaction's `END` statement (line 633: `for (const effect of effects) effect()`). If a post-commit effect fails, the already-committed transaction cannot roll back.
**Fix:** Move the effect execution INSIDE the transaction, before the commit. If an effect throws, the transaction rolls back naturally.
```ts
// Before (line 630-633):
db.transaction = cb => {
  const effects: Array<() => void> = []
  // ... collect effects ...
  for (const effect of effects) effect() // AFTER commit
}
// After:
db.transaction = cb => {
  const effects: Array<() => void> = []
  // ... collect effects ...
  for (const effect of effects) effect() // INSIDE transaction, before commit
}
```
Actually, for SQLite transactions, effects should execute before the transaction is committed. Reorder the `tx.runEND` / `effects.forEach` sequence.

## Fix 5: Tool call cleanup race condition in processor
**File:** `packages/opencode/src/session/processor.ts:507-529`
**Root cause:** `cleanup()` iterates `ctx.toolcalls` while `settleToolCall()` can concurrently delete entries. A tool call could be neither marked as completed nor errored if delete races with cleanup iteration.
**Fix:** In `cleanup()`, snapshot the tool call entries into an array before iterating, and only process entries that still exist after settling:
```ts
// Before (line 512):
yield* Effect.forEach(Object.values(ctx.toolcalls), ...)
// After: snapshot and process only existing entries
const pending = Object.entries(ctx.toolcalls)
yield* Effect.forEach(pending, ([id, call]) => {
  if (!ctx.toolcalls[id]) return Effect.void // already settled
  // mark as error
})
```

## Fix 6: RPC message handler has no JSON parse error handling
**File:** `packages/opencode/src/util/rpc.ts:7,27`
**Validation:** CONFIRMED — both `listen()` (line 7) and `client()` (line 27) use unprotected `JSON.parse`.
**Root cause:** `JSON.parse(evt.data)` can throw on malformed messages, crashing the entire message handler and stopping all further RPC communication.
**Fix:** Wrap both `JSON.parse` calls in try/catch:
```ts
// Before (line 27):
const rpc = JSON.parse(evt.data) as RpcMessage
// After:
let rpc: RpcMessage
try {
  rpc = JSON.parse(evt.data)
} catch {
  return // skip malformed messages
}
```

## Fix 7: Unhandled rejection/exception handlers don't exit process
**File:** `packages/opencode/src/index.ts:55-65`
**File:** `packages/opencode/src/cli/cmd/tui/worker.ts:29-39`
**Root cause:** Global error handlers `console.error` and return, process continues in potentially corrupted state.
**Fix:** Call `process.exit(1)` after logging the error:
```ts
// Before (index.ts lines 55-65):
process.on("unhandledRejection", (e) => {
  console.error(formatError(e))
})
// After:
process.on("unhandledRejection", (e) => {
  console.error(formatError(e))
  process.exit(1)
})
```
Same for `uncaughtException` in both files and worker.ts.

## Fix 8: OAuth state dual-generation causes CSRF check failure
**File:** `packages/opencode/src/mcp/index.ts:824-829` + `packages/opencode/src/mcp/oauth-provider.ts:155-169`
**Root cause:** Both `startAuth()` (line 746-749) and the SDK's auto-auth `state()` method (oauth-provider.ts:155-169) generate and store OAuth states. If the SDK path runs, it overwrites the state stored by `startAuth()`, causing the CSRF comparison at line 827 to fail for legitimate flows.
**Fix:** In `oauth-provider.ts`, when generating state during auto-auth, check if a state already exists for this MCP name and reuse it instead of generating a new one:
```ts
// In oauth-provider.ts state() method:
const existing = await auth.getOAuthState(name)
if (existing) return existing
// ... generate new state
```
Or: make `startAuth()` skip state generation if the SDK has already set one.

## Fix 9: REMOVED — Reader-writer lock already handles writer prioritization
**Validation:** The `read()` function at line 50 already checks `waitingWriters`: `if (lock.writer || lock.waitingWriters > 0)`. The existing code correctly queues new readers when writers are waiting. No fix needed.

## Fix 10: Windows path handling in ripgrep tree
**File:** `packages/opencode/src/file/ripgrep.ts:441`
**Root cause:** `file.split(path.sep)` uses `\` on Windows, but ripgrep always outputs paths with `/` regardless of platform.
**Fix:** Split on `/` instead of `path.sep`:
```ts
// Before:
const parts = file.split(path.sep)
// After:
const parts = file.split("/")
```

---

## Fix 11: Doom loop detection uses order-dependent JSON.stringify
**File:** `packages/opencode/src/session/processor.ts:307-319`
**Root cause:** `JSON.stringify` for JS objects with non-numeric keys doesn't guarantee order. `{a:1,b:2}` vs `{b:2,a:1}` not detected as equal.
**Fix:** Use `Bun.deepEquals` or sort keys before comparison:
```ts
// Before (line 313):
if (JSON.stringify(part.state.input) === JSON.stringify(value.input))
// After:
if (Bun.deepEquals(part.state.input, value.input))
```

## Fix 12: Effect HttpApi errors fall through to 500
**File:** `packages/opencode/src/server/middleware.ts:16-37`
**Validation:** CONFIRMED — issue is real. Import path corrected.
**Root cause:** Effect HttpApi errors are not instances of the handled error types, so they fall to the generic 500 handler.
**Fix:** Import from `effect/unstable/httpapi` (NOT `@effect/platform/HttpApiError`):
```ts
import { HttpApiError } from "effect/unstable/httpapi"

// In the error handler — the implementation uses per-subclass instanceof checks
// to determine the correct HTTP status code for each variant:
//   HttpApiError.BadRequest, HttpApiError.Unauthorized, HttpApiError.Forbidden, etc.
```

## Fix 13: `listGlobal()` returns inconsistent shapes between DB modes
**File:** `packages/opencode/src/session/session.ts:836-896`
**Root cause:** Project-DB mode (line 858) constructs `GlobalInfo` manually with `slug: ""` and `version: ""`, while non-project-DB mode (line 893) preserves actual values from `fromRow()`.
**Fix:** In project-DB mode, query the project info to get actual `slug` and `version` values, or at minimum normalize both paths to use the same shape. Check if `projectDb()` has access to project metadata that contains `slug`/`version`.

## Fix 14: FK constraint failures silently drop updates in projectors
**File:** `packages/opencode/src/session/projectors.ts:150-151,196-198`
**Root cause:** Foreign key constraint errors caught and logged as warning, updates permanently lost with no retry.
**Fix:** At minimum, raise the log level to `error`. Ideally, add a retry mechanism or store failed events in a dead-letter queue. For now, change `Log.warn` to `Log.error`:
```ts
// Before (lines 150-151):
Log.warn("ignored late message update", { error: e.message })
// After:
Log.error("ignored late message update — message references deleted session?", { error: e.message })
```

## Fix 15: obsolete `resolveSessionProject()` migration path
**File:** `packages/opencode/src/session/session.ts`
**Validation:** SUPERSEDED — the old `resolveSessionProject()` path depended on `SessionIndexTable` and `Database.isProjectDbMode()`, both of which were removed with the no-global-database redesign.
**Resolution:** There is no longer a global session-index lookup to catch or swallow errors. Session/project routing now comes from explicit project context and `Database.usesProjectDb(worktree)`, while executable-level sessions route to the executable-local DB.
**Status:** Closed by migration-removal work on 2026-05-14.

---

## Verification
1. `bun typecheck` in `packages/opencode` after all changes
2. Existing test suite: `bun test` in `packages/opencode`
3. Manual TUI testing for session delete/rename operations
4. Check migration applies cleanly (SQLite FK constraint additions)
