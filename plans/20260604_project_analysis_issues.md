# Project Analysis - Potential Issues

**Created:** 2026-06-04
**Scope:** Full codebase analysis for TypeScript errors, runtime bugs, security issues, test failures, and documentation gaps.

---

## Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Runtime/Logic Bugs | 0 | 3 | 8 | 6 | 17 |
| TypeScript Issues | 0 | 0 | 8 | ~200 | ~208 |
| Test Failures | 3 | 1 | 2 | 26 todo | 32 |
| Security Concerns | 0 | 0 | 4 | 6 | 10 |
| Documentation Gaps | 2 | 4 | 3 | 2 | 11 |

---

## Critical Priority Issues

### 1. Plan-to-Code Gap: Non-Existent `toolResultOutput()` Function
- **File:** `plans/20260601_complete_remaining_items.md` item 2.3
- **Issue:** Plan lists `toolResultOutput()` as a function to extract, but it does not exist anywhere in the codebase. The plan has no `[ ]` checkbox markers, making progress untrackable.
- **Impact:** Misleading development tracking; incomplete refactoring.
- **Fix:** Either implement the missing extraction or remove it from the plan. Add `[ ]`/`[x]` markers to all items.

### 2. DOCINDEX.md Lists Wrong Active Plans
- **File:** `DOCINDEX.md` lines 73-74
- **Issue:** Lists `plans/bug-resolution-plan.md` and `plans/20260518_project_health_plan.md` as active, but both are in `plans_completed/`. Missing all 3 actual active plans.
- **Impact:** Developers cannot find current active plans.
- **Fix:** Update DOCINDEX.md to reference the actual active plans in `plans/`.

### 3. index.md and DOCINDEX.md Reference Non-Existent Research Files
- **Files:** `index.md:55-58`, `DOCINDEX.md:106-112`
- **Issue:** Both reference `research/research_v1.md`, `research_v2.md`, `research_v3.md` — none of these files exist. The `research/` directory is empty; actual research is in `research_done/` (only `research_v4.md`).
- **Impact:** Broken references; developers cannot find research artifacts.
- **Fix:** Update references to point to `research_done/research_v4.md` or restore the missing files.

---

## High Priority Issues

### 4. Windows Path Handling Bug in `tool/ls.ts` — **[x] FIXED 2026-06-22**
- **File:** `packages/opencode/src/tool/ls.ts:91,112`
- **Issue:** `dir.split("/")` uses hardcoded forward slash. On Windows, `path.dirname()` returns backslash-separated paths, so this split won't work correctly on Windows. Additionally, line 112 `path.dirname(d) === dirPath` compares backslash with forward-slash paths.
- **Also fixed:** `packages/opencode/src/file/ripgrep.ts:441` — same `file.split("/")` bug in `tree()` function.
- **Fix:** Normalize with `dir.replace(/\\/g, "/")` before split/comparison (matches pattern in `directory-display.ts`).

### 5. `setInterval` Without Cleanup in `provider/models.ts`
- **File:** `packages/opencode/src/provider/models.ts:174-179`
- **Issue:** `setInterval()` ID is never stored, so it can never be cleared. Interval continues indefinitely even if module reloads.
- **Impact:** Resource leak; process cannot cleanly shut down model refresh.
- **Fix:** Store interval ID and clear it on module disposal.

### 6. `setInterval` Stored in `globalThis` But Never Cleared
- **File:** `packages/opencode/src/provider/gateway/mod.ts:139`
- **Issue:** `globalThis.__gatewayStatusInterval = statusInterval` stores the interval but no code reads this and calls `clearInterval`.
- **Impact:** Interval continues after gateway shutdown.
- **Fix:** Add cleanup code that reads and clears `globalThis.__gatewayStatusInterval`.

---

## Medium Priority Issues

### 7. `isNaN()` vs `Number.isNaN()` Inconsistency — **[x] FIXED 2026-06-22**
- **Files:** `packages/opencode/src/cli/cmd/stats.ts:337-343` (4 occurrences), `packages/opencode/src/mcp/index.ts:447` (1 occurrence).
- **Issue:** Global `isNaN()` coerces non-numeric types to numbers before checking, potentially masking type errors.
- **Fix:** Replaced all 5 occurrences with `Number.isNaN()`. No bare `isNaN()` remains in `packages/opencode/src`.

### 8. Fetch Without `.catch()` Error Handling
- **File:** `packages/opencode/src/cli/cmd/providers.ts:301`
- **Issue:** `fetch().then(x => x.json())` has no `.catch()` handler. Network errors or non-JSON responses cause unhandled rejections.
- **Fix:** Add `.catch()` or wrap in `Effect.tryPromise`.

### 9. `void` Fire-and-Forget Patterns (Multiple Files)
- **Files:** `packages/opencode/src/session/llm.ts:346`, `packages/opencode/src/server/routes/instance/session.ts:898,934`, `packages/opencode/src/server/routes/instance/httpapi/session.ts:757,763`, `packages/opencode/src/file/watcher.ts:100-102`, `packages/opencode/src/control-plane/workspace.ts:577`, `packages/opencode/src/config/command.ts:40`, `packages/opencode/src/config/agent.ts:123,155`, `packages/opencode/src/acp/agent.ts:247,1258`
- **Issue:** `void promise` fires promises without error handling. If any reject, the rejection is unhandled.
- **Fix:** Either await with try/catch, or attach `.catch()` to the promise.

### 10. Non-Null Assertions That Could Fail
- **Files:** `packages/opencode/src/util/lock.ts:20`, `packages/opencode/src/provider/gateway/store.ts:423,430`, `packages/opencode/src/provider/gateway/limiter.ts:44`, `packages/opencode/src/mcp/oauth-callback.ts:104,130`, `packages/opencode/src/shell/shell.ts:116`, `packages/opencode/src/cli/cmd/tui/win32.ts:39,82,86`, `packages/opencode/src/format/index.ts:90`, `packages/opencode/src/tool/ls.ts:99`
- **Issue:** `!` assertions on `Map.get()` or array `[0]` that could fail if the key/element doesn't exist.
- **Fix:** Add existence checks before using `!` or use optional chaining.

### 11. Test Failures: `packages/core` npm-config Tests (5 failures)
- **File:** `packages/core/test/npm-config.test.ts`
- **Issue:** `@npmcli/config` is not reading `.npmrc` files correctly in tests — falls back to default registry.
- **Fix:** Investigate `npmPath` resolution or `@npmcli/config` initialization pattern.

### 12. Test Failures: `packages/ui` Diff Text Tests (2 failures)
- **Files:** `packages/ui/src/components/apply-patch-file.test.ts`, `packages/ui/src/components/session-diff.test.ts`
- **Issue:** `text()` function joins lines with `""` but tests expect `"\n"` between lines.
- **Fix:** Either fix `text()` to join with `"\n"` or correct test expectations.

### 13. Test Failures: `packages/enterprise` Storage Tests (16 failures)
- **Files:** `packages/enterprise/test/core/share.test.ts`, `packages/enterprise/test/core/storage.test.ts`
- **Issue:** Tests require `OPENCODE_STORAGE_ADAPTER` env var and S3/R2 credentials. Cannot run locally.
- **Fix:** Add a mock/local storage adapter for development testing.

### 14. `complete_remaining_items.md` Has No Status Markers
- **File:** `plans/20260601_complete_remaining_items.md`
- **Issue:** No `[x]`/`[ ]` checkbox markers on any item, violating the plan convention. Progress is untrackable.
- **Fix:** Add status markers to all items.

### 15. Stale Line Numbers in `upstream_adoption_phase2.md`
- **File:** `plans/20260601_upstream_adoption_phase2.md`
- **Issue:** References processor.ts:288 (code doesn't exist at that line) and prompt.ts:1300-1312 (now at 1132-1142).
- **Fix:** Update line numbers.

### 16. `index.md` Undercounts Completed Plans
- **File:** `index.md:52`
- **Issue:** Claims "22 plans" in `plans_completed/` — actual count is 35.
- **Fix:** Update count.

---

## Low Priority Issues

### 17. `catch (e: any)` Usage (8 instances)
- **Files:** `packages/core/src/filesystem.ts:212`, `packages/console/core/src/billing.ts:121,374`, `packages/function/src/api.ts:350`, `packages/console/app/src/routes/zen/util/handler.ts:349`, `packages/console/app/src/routes/auth/[...callback].ts:37`, `packages/opencode/src/session/llm.ts:320`, `packages/opencode/src/cli/cmd/github.ts:690`
- **Issue:** Error typed as `any` instead of `unknown`. All do log the error (no silent swallowing), but type safety is lost.
- **Fix:** Use `unknown` type and narrow appropriately.

### 18. `as any` Assertions (~200 instances)
- **Largest clusters:** AI SDK provider integration (`provider/provider.ts`, `provider/transform.ts`), plugin system metadata, attachment handlers, console provider adapters.
- **Issue:** Many are necessary interop with untyped external APIs, but some could be tightened with proper types.
- **Fix:** Prioritize reducing `any` in core packages (`opencode`, `core`, `plugin`) where external API interop is less constraining.

### 19. Insecure Temp File Handling
- **Files:** `packages/desktop/src-tauri/src/cli.rs:141-142`, `packages/native/markdownify/src/main.rs:114`
- **Issue:** Predictable temp file names (TOCTOU race condition).
- **Fix:** Use cryptographically random temp file names.

### 20. Sensitive Data in Logs
- **Files:** `packages/slack/src/index.ts:11-14`, `packages/opencode/src/cli/cmd/tui/attach.ts:66`, `packages/opencode/src/cli/cmd/run.ts:648`, `packages/desktop-electron/src/main/server.ts:87`
- **Issue:** Logs presence of tokens; constructs Basic auth headers that could be logged.
- **Fix:** Remove presence logging; ensure auth headers are never logged.

### 21. SSL Certificate Validation Bypass Config
- **File:** `packages/console/core/drizzle.config.ts:16`
- **Issue:** Allows disabling SSL cert validation via env var.
- **Fix:** Document the risk; consider requiring explicit opt-in flag.

### 22. Skipped Test Files
- **Files:** `packages/opencode/test/util/log.test.ts` (entire suite skipped), `packages/opencode/test/snapshot/snapshot.test.ts` (1 unconditional skip)
- **Issue:** Tests skipped with no clear path to re-enabling.
- **Fix:** Either fix and re-enable or document why permanently skipped.

### 23. 26 `.todo` Stub Tests
- **Packages:** `ui` (7), `sdk/js` (3), `plugin` (8), `function` (7), `opencode` (1)
- **Issue:** Placeholder tests with no implementation.
- **Fix:** Implement or remove.

### 24. 8 Packages With Zero Test Coverage
- **Packages:** `web`, `storybook`, `slack`, `script`, `desktop`, `console/resource`, `console/mail`, `console/function`
- **Issue:** No test files at all.
- **Fix:** Add basic test coverage.

### 25. `session-ses_19a8.md` at Repo Root
- **File:** `D:\zPython\opencode\session-ses_19a8.md` (14,783 lines)
- **Issue:** Stray session transcript cluttering repo root.
- **Fix:** Move to `.opencode/data/` or delete.

---

## Plan Items

- [ ] **P1:** Fix plan-to-code gap — implement or remove `toolResultOutput()` reference; add `[ ]`/`[x]` markers to all items in `complete_remaining_items.md`
- [ ] **P1:** Update `DOCINDEX.md` to list correct active plans
- [ ] **P1:** Fix `index.md` and `DOCINDEX.md` references to non-existent research files
- [x] **P2:** Fix Windows path handling in `tool/ls.ts` — normalize backslashes before split/comparison (also fixed `ripgrep.ts:441`)
- [ ] **P2:** Fix `setInterval` cleanup in `provider/models.ts` — store and clear interval ID
- [ ] **P2:** Fix `setInterval` cleanup in `provider/gateway/mod.ts` — clear `globalThis.__gatewayStatusInterval`
- [x] **P2:** Replace `isNaN()` with `Number.isNaN()` in `cli/cmd/stats.ts` and `mcp/index.ts`
- [ ] **P2:** Add `.catch()` to fetch in `cli/cmd/providers.ts`
- [ ] **P2:** Add error handling to `void` fire-and-forget patterns (8+ locations)
- [ ] **P2:** Add existence checks before non-null assertions (8 locations)
- [ ] **P2:** Fix `packages/core` npm-config test failures
- [ ] **P2:** Fix `packages/ui` diff text test failures
- [ ] **P2:** Add mock storage adapter for `packages/enterprise` tests
- [ ] **P2:** Update stale line numbers in `upstream_adoption_phase2.md`
- [ ] **P2:** Update `index.md` completed plans count
- [ ] **P3:** Reduce `catch (e: any)` to `unknown` (8 instances)
- [ ] **P3:** Tighten `as any` assertions where possible (prioritize core packages)
- [ ] **P3:** Fix insecure temp file handling in Rust code
- [ ] **P3:** Remove sensitive data presence logging
- [ ] **P3:** Re-enable or document skipped tests
- [ ] **P3:** Implement or remove 26 `.todo` stub tests
- [ ] **P3:** Add test coverage to 8 packages with zero tests
- [ ] **P3:** Clean up stray `session-ses_19a8.md` file
