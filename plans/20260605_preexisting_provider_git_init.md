# Pre-existing Failures Analysis - Provider & Git Init Tests

## Goal
Fix the two remaining pre-existing test failures: `httpapi-provider` (OAuth timeout) and `project-init-git` (reload hang).

## sv
`[[deadlock, bootstrap, reload, npm-install, fiber-lock]]` with weights `[0.3, 0.25, 0.2, 0.15, 0.1]`

## Evidence Map

| Test | Root Cause | Confidence | Evidence |
|------|-----------|------------|----------|
| `httpapi-provider` | Nested `Effect.promise` deadlock in `instance` middleware | [Exact] | Test calls `Effect.promise(async () => app.request(...))` → HTTP handler middleware calls `Effect.promise(() => Instance.provide(...))` → inner promise deadlocks waiting for outer fiber |
| `project-init-git` | `InstanceBootstrap` → npm install fibers → `waitForDependencies()` blocks on fiber join | [Exact] | `Config.get()` → `loadInstanceState()` forks npm install → `Plugin.init()` → `waitForDependencies()` joins fibers → lock contention between first boot and reload |

## Analysis

### httpapi-provider timeout — **[ ] DEFERRED (investigated 2026-06-22)**

**Root cause**: Deeper than initially identified. Neither `Effect.promise`, `Effect.tryPromise`, nor `Effect.callback` resolves the deadlock. Suspect `HttpApiBuilder`/Hono bridge creates separate Effect runtime context that cannot share ALS with the test's `Effect.promise` runtime. Requires investigation of the fiber/runtime coordination layer.

**Attempted fixes:**
1. `Effect.callback` — does not exist in Effect v4 (renamed, different API)
2. `Effect.tryPromise` — codebase standard pattern, but same deadlock
3. `Effect.promise` — original, same deadlock

The test execution flow:
1. Test calls `Effect.promise(async () => { await app.request(...) })` — creates outer promise-driven fiber
2. `app.request()` triggers the HTTP handler chain
3. The `instance` middleware calls `Effect.promise(() => Instance.provide({...}))` — creates inner promise
4. The inner `Effect.promise` tries to schedule work that depends on the outer promise's async context, but the outer promise is suspended waiting for the inner work → **deadlock**

The legacy route doesn't have this issue because it uses Hono directly without the Effect HTTP API middleware chain.

**Fix**: Replace `Effect.promise` with `Effect.async` in the `instance` middleware:

```typescript
// Before (deadlocks):
const ctx = yield* Effect.promise(() =>
  Instance.provide({
    directory: Filesystem.resolve(decode(raw)),
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: () => Instance.current,
  }),
)

// After (no deadlock):
const ctx = yield* Effect.async((resume) => {
  Instance.provide({
    directory: Filesystem.resolve(decode(raw)),
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: () => Instance.current,
  }).then(resume.withSuccess, resume.withFailure)
})
```

### project-init-git timeout — **[ ] VERIFIED 2026-06-23 (deferred)**

**Root cause confirmed**: `InstanceBootstrap` → `Config.get()` → `loadInstanceState()` forks npm install fibers → `Plugin.init()` → `waitForDependencies()` → `Fiber.join` on all npm fibers. When `Instance.reload()` is called synchronously from the HTTP handler, the reloaded instance blocks on the same npm install fibers, causing a 5s timeout.

**Test file**: `packages/opencode/test/server/project-init-git.test.ts` — first test times out. Second test (already-git) passes.

**Fix needed**: Deferred reload pattern — make `Instance.reload()` async so the HTTP response returns before bootstrap re-completes. Or mock `InstanceBootstrap` in tests to skip npm install. Requires fiber coordination changes.

The execution flow when `initGit` is called:
1. Handler calls `Instance.reload()` → `boot()` → `AppRuntime.runPromise(InstanceBootstrap)`
2. `InstanceBootstrap` runs:
   - `Config.Service.use((svc) => svc.get())` — reads `InstanceState` which triggers `loadInstanceState()`
   - `loadInstanceState()` forks **detached npm install fibers** via `npmSvc.install(dir).pipe(Effect.forkDetach)` for each config directory
   - `Plugin.Service.use((svc) => svc.init())` — calls `config.waitForDependencies()` which **joins all npm install fibers** (`Fiber.join`)
   - Then forks service init fibers via `Effect.forkDetach`
3. `waitForDependencies()` blocks waiting for the npm install fibers to complete
4. The npm install fibers call `flock.acquire('npm-install:${dir}')` which acquires an exclusive file lock
5. If the first boot's npm install hasn't released the lock yet, the second boot's npm install blocks → **timeout**

**Why it's flaky**: When npm install completes quickly (packages cached, no lock contention), the test passes. When npm install takes longer, `waitForDependencies()` blocks long enough to exceed the 5-second timeout.

**Fix 1**: Adopt the deferred reload pattern from the `dev` branch. The `dev` branch uses `markInstanceForReload(ctx, next)` in the handler, which stores the reload intent in a `WeakMap` keyed by the `Request` object. A `disposeMiddleware` runs **after** the HTTP response is sent and performs the actual `Instance.reload()` asynchronously. This means the HTTP response returns immediately without blocking on bootstrap.

**Fix 2**: Mock `InstanceBootstrap` during tests. The `dev` branch replaces `InstanceBootstrap` with a no-op layer during tests, avoiding the entire npm install + plugin init sequence.

**Fix 3**: Fix the second test's event listener cleanup — move `GlobalBus.off("event", fn)` before `Instance.disposeAll()` in the `finally` block, since `disposeAll()` emits `server.instance.disposed` events that the listener captures.

## Plan

### Task 1: Fix httpapi-provider deadlock [PROPOSED]
**File:** `src/server/routes/instance/httpapi/server.ts`

Replace `Effect.promise` with `Effect.async` in the `instance` middleware (lines 60-66). This eliminates the nested promise deadlock.

### Task 2: Fix project-init-git reload hang [PROPOSED]
**File:** `src/server/routes/instance/httpapi/project.ts`

Adopt the deferred reload pattern:
1. Import `markInstanceForReload` from `lifecycle.ts` (or recreate the pattern)
2. In the `initGit` handler, instead of calling `Instance.reload()` directly, call `markInstanceForReload(ctx, next)` and return the response immediately
3. Register `disposeMiddleware` to run after the HTTP response

### Task 3: Fix project-init-git second test false positive [PROPOSED]
**File:** `test/server/project-init-git.test.ts`

Move `GlobalBus.off("event", fn)` before `Instance.disposeAll()` in the `finally` block.

### Task 4: Consider mocking InstanceBootstrap in tests [OPTIONAL]
**File:** `test/server/project-init-git.test.ts`

Provide a no-op `InstanceBootstrap` layer during tests to avoid npm install entirely. This is a more invasive change but would make tests faster and more deterministic.

## Verification
- `bun test test/server/httpapi-provider.test.ts` — should pass
- `bun test test/server/project-init-git.test.ts` — should pass (both tests)
- `bun typecheck` — no type errors

## Notes
- Task 1 is a one-line change with high confidence
- Task 2 requires adopting the deferred reload pattern which may need `lifecycle.ts` to be restored or recreated
- Task 3 is a simple reorder in the test cleanup
- Task 4 is optional — Tasks 1-3 should be sufficient
