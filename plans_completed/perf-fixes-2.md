# Performance & Correctness Fixes from Research v3

Based on `research/research_v3.md`. Items already fixed in the v2 round (health-window, store eviction, external-directory, compaction, N+1 query) are excluded. Read concurrency is excluded per user request.

## Items

### 1. Add non-throwing `getStore()` to `LocalContext`

**File:** `packages/opencode/src/util/local-context.ts`
**Severity:** High
**Effort:** Low
**Risk:** Low

**Problem:** The `LocalContext.create()` wrapper only exposes a throwing `use()` method. All "maybe" lookups in `db.ts` use `try { ctx.use() } catch` to detect absence (lines 317, 338, 354, 369, 400). Throw/catch in hot resolution paths is ~500x slower than a direct `getStore()` check (microbenchmark: 5309ms vs 10ms for 1M calls).

**Fix:**
1. Add a `getStore()` method to the object returned by `LocalContext.create()` that calls `storage.getStore()` and returns `T | undefined` (non-throwing)
2. Keep the existing `use()` method for code that needs the assertion
3. Replace the 5 `try { ctx.use() } catch` patterns in `db.ts` with `ctx.getStore()` checks
4. Update `Instance.currentMaybe` (in `instance.ts`) and `WorkspaceContext.workspaceID` (in `workspace-context.ts`) to use `getStore()` internally instead of try/catch

### 2. Cache fallback DB client

**File:** `packages/opencode/src/storage/db.ts`
**Severity:** High
**Effort:** Low
**Risk:** Medium

**Problem:** In `use()` (line 328) and `transaction()` (line 379), when the project context is absent, the fallback path calls `createAndInitDb(path.join(Global.Path.data, "opencode.db"))` every time. This opens a fresh SQLite connection, runs PRAGMAs, and executes schema on each call — unlike project DBs which are cached in `projectClients` Map.

**Fix:**
1. Add a module-level `let defaultDb: DrizzleClient | undefined`
2. Create a `getDefaultDb()` function: `defaultDb ??= createAndInitDb(path.join(Global.Path.data, "opencode.db"))`
3. Replace inline `createAndInitDb(...)` in `use()` (line 327) and `transaction()` (line 379) with `getDefaultDb()`
4. Add `defaultDb = undefined` (or close it) in the `close()` function alongside `closeAllProjectDbs()`

### 3. Fix H2 session bookkeeping

**File:** `packages/opencode/src/provider/gateway/h2-transport.ts`
**Severity:** High
**Effort:** Medium
**Risk:** Medium

**Problems:**
- **`remoteMaxConcurrentStreams` stale:** The `remoteSettings` handler (line 46) updates a local variable `remoteMaxStreams`, but the `H2Session` object is populated once at creation (line 75). When the server sends updated settings, the stored session object is never updated.
- **`activeStreams` never tracked:** The field exists (line 14, initialized to 0 at line 76) but is never incremented/decremented in `request()` or `requestStream()`.

**Fix:**
1. In the `remoteSettings` handler, update `h2Session.remoteMaxConcurrentStreams` on the stored session object (not just the local variable)
2. Increment `session.activeStreams++` when a request starts (in both `request()` and `requestStream()`)
3. Decrement `session.activeStreams = Math.max(0, session.activeStreams - 1)` on request end/error/close via a shared `done` handler

### 4. Gateway store persistence — off-main-thread serialization

**File:** `packages/opencode/src/provider/gateway/store.ts`
**Severity:** Medium
**Effort:** Medium
**Risk:** Medium

**Problem:** `persist()` (line 230) uses `new Promise(r => setImmediate(() => r(JSON.stringify(...))))`. This defers serialization by one event-loop tick but `JSON.stringify` still runs on the main thread, blocking it for large route stores.

**Fix:** Use Bun's `Bun.ThreadPool` or a `Worker` thread for JSON serialization. Since this runs in a `setInterval` (line 249) every 30 seconds, acceptable. Alternatively, use `Bun.write` with streaming serialization if the store is large. Simpler approach: keep the `setImmediate` but note that for very large stores (>10k routes), a `Worker` would be better. Since MAX_ROUTES is 500, the current approach is actually fine for now — downgrade priority.

**Decision:** Skip for now — MAX_ROUTES=500 limits the JSON payload to ~50-100KB, so `setImmediate(JSON.stringify(...))` is acceptable. Not a bottleneck at current scale.

### 5. Make projector init explicit and idempotent

**File:** `packages/opencode/src/server/projectors.ts`
**Severity:** Medium
**Effort:** Low
**Risk:** Low

**Problem:** `initProjectors()` is called at module import time (line 28). Import-time side effects make startup non-deterministic and can cause duplicate registrations in test reloads or multi-entry paths.

**Fix:**
1. Add a guard inside `initProjectors()`: check `if (projectors !== undefined) return` (use existing `SyncEvent` state rather than a separate flag)
2. Ensure `SyncEvent.reset()` clears `projectors` (it already does at line 61, but verify) so the guard resets naturally
3. Both the module-level call (line 28) and the explicit call in `server.ts` (line 26) become safe — second call is a no-op
4. No caller removal needed in this step; existing call sites remain compatible

## Verification

- Run `bun typecheck` in `packages/opencode` after each fix
- For ALS: verify `getStore()` returns `undefined` when no context is set, not throws
- For DB cache: verify fallback DB is created only once across multiple `use()` calls
- For H2: verify `remoteMaxConcurrentStreams` updates reflect received settings
- For projectors: verify projector init is idempotent when called multiple times
