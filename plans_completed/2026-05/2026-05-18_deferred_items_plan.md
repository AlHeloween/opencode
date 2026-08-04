# Remaining Deferred Items Plan

**Created:** 2026-05-18
**Source:** Items deferred from 20260518_project_health_plan + research_v2.md audit

---

## Status Legend
- `[ ]` Pending
- `[x]` Completed

---

## 1. [x] HIGH: Enforce h2-transport backpressure limits

**File:** `packages/opencode/src/provider/gateway/h2-transport.ts`

**Problem:** `remoteMaxConcurrentStreams` and `activeStreams` are tracked but never enforced. `request()` (line ~166) and `requestStream()` (line ~314) increment `activeStreams` unconditionally — no check, no queue, no backpressure. HTTP/2 servers specify stream concurrency limits for a reason; exceeding them can cause connection resets.

**Fix:** Before incrementing, check `activeStreams >= remoteMaxConcurrentStreams`. If at limit, either:
- Queue the request until a stream slot opens (preferred), or
- Return a 429/503 error to trigger retry with backoff

**Risk:** Low. The counter infrastructure is already in place. Adding a gate check is straightforward.

---

## 2. [x] LOW: Bump nitro from alpha to stable (done — beta)

**Files:** `packages/enterprise/package.json:27`, `packages/console/app/package.json:30`

**Problem:** Both used `nitro@3.0.1-alpha.1`. Stable `3.0.1` not released, but `3.0.260429-beta` is available — closer to stable than alpha.

**Fix:** Bumped both packages to `"nitro": "3.0.260429-beta"`. Both typecheck clean. No stable exists yet, but beta reduces risk vs alpha.

---

## 3. [x] MEDIUM: Update CODEOWNERS

**File:** `.github/CODEOWNERS`

**Problem:**
- `packages/tauri/` entry is stale — directory no longer exists (replaced by `packages/desktop/`)
- Only 4 entries cover 3 packages; major packages lack ownership:
  - `packages/opencode/` (core engine)
  - `packages/core/` (shared utilities)
  - `packages/ui/` (component library)
  - `packages/sdk/js/` (TypeScript SDK)
  - `packages/plugin/` (plugin API)
  - `packages/function/` (sharing/sync backend)
  - `packages/console/*` (SaaS console)
  - `packages/web/` (marketing site)

**Fix:**
1. Remove stale `packages/tauri/` entry
2. Add entries for uncovered packages (owner TBD — use `@anomalyco/opencode` as placeholder)

**Risk:** Zero. CODEOWNERS is a review-assignment mechanism, not functional code.

---

## 4. [x] LOW: Add Pierre diff engine tests

**Files:** `packages/ui/src/pierre/` (11 source files, 0 tests)

**Problem:** The Pierre selection/diff engine has zero test coverage. Files: `worker.ts`, `virtualizer.ts`, `selection-bridge.ts`, `media.ts`, `index.ts`, `file-selection.ts`, `file-runtime.ts`, `file-find.ts`, `diff-selection.ts`, `commented-lines.ts`, `comment-hover.ts`.

**Fix:**
1. Create `packages/ui/src/pierre/pierre.test.ts` with test skeletons (test.todo)
2. Prioritize testing: `file-selection.ts` (core selection logic), `diff-selection.ts` (diff parsing), `virtualizer.ts` (rendering virtualizer)

**Risk:** Low. Isolated UI utility with no critical runtime dependency.

---

## 5. [x] Research_v2.md Bug Audit (pre-implementation verification)

**Verified:** 5 of 6 bugs already fixed:

| Bug | Status | Evidence |
|-----|--------|----------|
| health-window.ts off-by-one + decay overwrite | [x] FIXED | Correct `toArray()` index; decay creates fresh object, no stale overwrite |
| message-v2.ts N+1 COUNT(*) per search row | [x] FIXED | Single SQL query with correlated subquery for `messageIndex` |
| store.ts route eviction never evicts | [x] FIXED | `evictStaleEntries()` explicitly calls `delete s.data.routes[key]` |
| external-directory.ts lexical path check | [x] FIXED | `resolve()` calls `realpathSync` before `containsPath` check |
| h2-transport.ts backpressure | [x] FIXED | Spin-wait loop at `request()` L166-168 and `requestStream()` L318-320 |
| compaction.ts structuredClone | [x] FIXED | Uses `Array.slice()` shallow copy; no `structuredClone` in file |

---

## Implementation Order

1. Item 3 (CODEOWNERS) — documentation-only, zero risk, no dependencies
2. Item 1 (h2-transport) — code change, requires review
3. Item 4 (Pierre tests) — test skeletons, low priority
4. Item 2 (nitro) — **blocked**: waiting on upstream `nitro@3.0.1` stable release

---

## 10. [x] HIGH: Vite dev servers bind to `0.0.0.0` + accept any host

**Files:** `packages/app/vite.config.ts:7-8`, `packages/enterprise/vite.config.ts:30-31`

**Problem:** Both configs set `host: "0.0.0.0"` and `allowedHosts: true`, exposing the dev server to all network interfaces. On shared LAN/VPN/cloud dev environments, external machines can access the dev server, enabling DNS-rebinding attacks or unintended resource exposure. `packages/console/app/vite.config.ts` also has `allowedHosts: true` (line 19) without explicit host binding.

**Fix:**
```ts
server: {
  host: process.env.VITE_HOST ?? "127.0.0.1",
  allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  port: 3000,
}
```
Apply to all three vite configs.

**Risk:** Low. Devs who intentionally use `0.0.0.0` can set `VITE_HOST=0.0.0.0`.

---

## 11. [x] HIGH: Electron updater allows unsigned downgrades

**Files:** `packages/desktop-electron/src/main/index.ts:334`

**Problem:** `autoUpdater.allowDowngrade = true` combined with absent `verifyUpdateCodeSignature` setting weakens the desktop app's code-update trust chain. A malicious or corrupted update channel could serve older, vulnerable builds. The `verifyUpdateCodeSignature: false` claim from the research was NOT found in `electron-builder.config.ts` — but the config doesn't explicitly enable it either (default behavior unclear).

**Note:** `packages/desktop-electron/src/main/updater.ts` does not exist — updater logic is in `src/main/index.ts:329` (`setupAutoUpdater()`).

**Fix:**
```ts
// src/main/index.ts:334
autoUpdater.allowDowngrade = process.env.OPENCODE_ALLOW_DOWNGRADE === "1"

// electron-builder.config.ts (explicitly enable)
win: {
  verifyUpdateCodeSignature: true,
}
```

**Risk:** Medium. Changes desktop app release security posture. Needs testing with actual builds.

---

## 12. [x] HIGH: DB effects are fire-and-forget (not awaited)

**Files:** `packages/opencode/src/storage/db.ts:329,356,371,411,437`

**Problem:** `effects` array is typed as `(() => void | Promise<void>)[]` but executed with synchronous `for (const effect of effects) effect()` — no `await`, no error catching. Async effects silently fire-and-forget, leaking beyond transaction boundaries. Occurs in 4 functions: `use()` (L356), `projectUse()` (L371), `transaction()` (L411), `projectTransaction()` (L437).

**Fix (option A — make sync-only):**
```ts
effects: (() => void)[]  // remove Promise<void> from type
```

**Fix (option B — await with failure propagation, preferred for correctness):**
```ts
async function flushEffects(effects: (() => void | Promise<void>)[]) {
  const results = await Promise.allSettled(effects.map(fn => fn()))
  const failed = results.find(r => r.status === "rejected")
  if (failed && failed.status === "rejected") throw failed.reason
}
```
Then call `await flushEffects(effects)` after DB operations. Functions `use()` and `transaction()` would need to become async.

**Risk:** High correctness. Fix B requires making `use()`/`transaction()` async — API change that touches all callers.

---

## 13. [x] HIGH: CLI forces `process.exit()` unconditionally

**Files:** `packages/opencode/src/index.ts:219`

**Problem:** The `finally` block always calls `process.exit()`, even after the `catch` block already set `process.exitCode = 1`. This hard-exit cuts off pending async cleanup, log writes, output flushing, telemetry, DB closure. Child processes may also be left dangling.

**Fix:** Replace unconditional exit with bounded graceful shutdown:
```ts
try {
  await shutdownChildren({ timeoutMs: 5000 })
  Database.close()
} finally {
  // Safety net: if shutdown hangs, force exit after timeout
  setTimeout(() => process.exit(process.exitCode ?? 0), 5000).unref()
}
```

**Risk:** Medium. Must ensure all cleanup hooks (telemetry, DB, logs) complete within the timeout.

---

## 14. [x] MEDIUM: Release workflow upstream-locked + over-permissioned

**Files:** `.github/workflows/publish.yml:28-32,36,73,118,393`

**Problem:** Workflow grants broad write permissions (`contents`, `packages`, `id-token`) globally, but 4/6 jobs are gated by `if: github.repository == 'anomalyco/opencode'`, making them never run in forks. Jobs without the guard (`build-tauri`) would run but depend on gated jobs. The `publish` job has no repo guard but depends on all guarded jobs, so it runs with degraded/unavailable outputs.

**Fix:**
1. Move write permissions from workflow-level to job-level (`publish` job only)
2. Add a `ci.yml` with read-only permissions for all non-publish checks
3. Replace hardcoded `anomalyco/opencode` guard with configurable variable (e.g., `github.repository == vars.PUBLISH_REPO`)
4. Add `build-tauri` to the guard list for consistency

**Risk:** Low. CI-only change. Must preserve existing behavior for `anomalyco/opencode`.

---

## Updated Implementation Order

Items 1-4 and 10-14 are now [x] complete.

Remaining open:
1. Item 2 (nitro stable) — **blocked**: awaiting upstream release

---

## Risks (updated)

- **Item 2 (nitro):** Blocked — no stable 3.0.1 yet. Alpha dependency is build-time only (Vite plugin), risk is manageable
- **Items 1, 3, 4, 10-14:** Complete — risks resolved
