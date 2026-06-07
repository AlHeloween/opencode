## Goal
Fix correctness issues in commit d338a574f (eliminate global database).

## Tasks

### [x] Remove accidental artifacts
- Deleted `test/server/httpapi-provider-debug.test.ts` (invalid TS — single `\` character)
- Deleted `analysis_session_db_mismatch.md` (stub file)
- Deleted `scripts/edit_server.py` (incomplete scratch)
- Deleted `scripts/patch_test_debug.py` (truncated scratch)

### [x] Fix DB project context resolver for Effect HTTP routes
- Replaced unused `fallbackProjectCtx` with fiber-aware `tryResolveProjectCtx()`
- New resolver checks: (1) `currentProjectCtx` (ALS), (2) Effect `Fiber.getCurrent()` + `InstanceRef`
- Applied to both `Database.use()` and `Database.transaction()`
- Removed `setProjectContext()`/`clearProjectContext()` exports (no callers)
- Files: `src/storage/db.ts`

### [x] Close config DB in Database.close()
- Added config DB close + clear to `Database.close()` so account.db handles are released on shutdown/test cleanup

### [x] Fix test DB reset to clean project DB files
- `test/fixture/db.ts`: capture worktrees from `getProjectWorktrees()` before calling `disposeAll()`/`clearProjectWorktrees()`, then remove DB/WAL/SHM files for each

### [x] Fix balance storage: replace require() with ESM imports
- `src/provider/balance-storage.ts`: replaced `require("@/session/session.sql")` and `require("drizzle-orm")` with top-level imports
- Fixed comment claiming it works outside Effect context

### [x] Make balance failures observable
- `src/session/processor.ts`: `checkAndSnapshotBalance()` now logs caught errors with `log.warn("bug: balance snapshot failed", ...)`

## Verification
- Run `bun typecheck` from `packages/opencode`
- Run targeted tests: `bun test test/storage/db.test.ts test/account/repo.test.ts test/account/service.test.ts test/provider/balance.test.ts test/server/session-messages.test.ts test/server/session-select.test.ts test/server/httpapi-json-parity.test.ts`
