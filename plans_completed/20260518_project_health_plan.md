# Project Health Improvement Plan

**Created:** 2026-05-18
**Scope:** Cross-cutting improvements across the OpenCode monorepo
**Source:** Comprehensive codebase analysis identifying critical, high, and medium-priority issues

---

## Status Legend
- `[ ]` Pending
- `[~]` In Progress
- `[x]` Completed
- `[!]` Blocked

---

## 1. [x] Critical: Fix Ephemeral `@solidjs/start` Dependency

**Affected:** Root `package.json:79` (catalog), `packages/enterprise/`, `packages/console/app/`

**Problem:** Catalog declared `"https://pkg.pr.new/@solidjs/start@dfb2020"` — an ephemeral CI artifact URL that can be garbage-collected, blocking `bun install` for all new clones and CI.

**Resolution:** Replaced with stable npm version `"1.3.2"` (published Feb 24, 2026). Both downstream packages consume via `catalog:` so the fix is single-point.

---

## 2. [x] Critical: Create Missing Repository Documentation Indexes

**Affected:** Repository root

**Problem:** Both `DOCINDEX.md` and `index.md` required by ADID framework and AGENTS.md were missing.

**Resolution:**
- Created `DOCINDEX.md` — documentation surface index with owners, entrypoints, and last_verified for all docs, specs, plans, and research
- Created `index.md` — folder-based repository map with purpose + key entrypoints for every top-level directory and package

---

## 3. [x] High: Pin `ghostty-web` Git Dependency

**Affected:** `packages/app/package.json:65`

**Problem:** `"github:anomalyco/ghostty-web#main"` pointed to a moving branch used by runtime terminal addon code.

**Resolution:** Pinned to commit `20bd3613f59dfc0f088a9aec498db2fa1a08b768` (Apr 19, 2026).

---

## 4. [x] High: Fix Silent Catch Blocks

**Affected:** `packages/ui/src/theme/context.tsx:101,108`, `packages/opencode/test/provider/provider.test.ts:2684,2711`

**Problem:** 4 `catch {}` blocks swallowed errors with no logging — bugs per AGENTS.md policy.

**Resolution:** Added `console.debug(...)` with descriptive messages in all four catch blocks.

---

## 5. [x] Medium: Reduce `any` Type Usage in Bus Module

**Affected:** `packages/opencode/src/bus/index.ts:38,161,184`

**Problem:** `subscribeAllCallback` used `(event: any) => unknown` where the base `Payload` type (= `Payload<BusEvent.Definition>`) was available.

**Resolution:** Replaced `any` with `Payload` in `Interface.subscribeAllCallback`, `subscribeAllCallback` implementation, and module-level `subscribeAll()`.

---

## 6. [x] Medium: Document Auto-Generated Code & Desktop TS Version

**Affected:** `AGENTS.md`

**Problem:** No visible documentation for regenerating auto-generated SDK and Tauri bindings. Desktop TypeScript version split (5.6.2 vs 5.8.2) had no documented rationale.

**Resolution:** Added "Auto-Generated Code" table (files, generators, commands) and "Dependency Notes" section documenting the intentional desktop TS pin.

---

## 7. [x] Medium: Add Test Skeletons to Untested Packages

**Affected:** `packages/function/`, `packages/plugin/`, `packages/sdk/js/`

**Problem:** Three critical packages had zero tests.

**Resolution:** Created skeleton test files with `test.todo()` stubs:
- `packages/function/test/api.test.ts` — share CRUD, sync, token exchange stubs
- `packages/plugin/test/plugin.test.ts` — loader, hooks, tool registration stubs
- `packages/sdk/js/test/sdk.test.ts` — client/server type export smoke test

---

## 8. [x] Medium: Triage Bug Resolution Plan

**Affected:** `plans/bug-resolution-plan.md`

**Problem:** ~46 cataloged bugs across 8 categories, only 2 with concrete fixes, 0 fixes applied, no triage guidance.

**Resolution:** Added triage guide to the plan:
- 2 actionable fixes (upgrade check for dev builds, clangd symlink guard)
- 18 bugs recommended for downgrade to `log.debug` (categories B, E, H — exit/shutdown, cleanup, RPC)
- 9 bugs recommended for downgrade to `log.debug` (category D — external tool failures)
- 8 + 4 + 6 bugs recommended to keep as `warn("bug:")` (categories C, F, G)
- Added process improvement note: after 30 days of real-usage confirmation, automate downgrades

---

## 9. [x] Medium: Normalize `@ai-sdk/*` Versions

**Affected:** Root `package.json` (catalog), `packages/console/function/package.json`

**Problem:** `@ai-sdk/*` versions drifted between opencode (3.0.78/3.0.64/2.0.47) and console/function (3.0.64/3.0.48/2.0.37).

**Resolution:**
- Added `@ai-sdk/anthropic: 3.0.78`, `@ai-sdk/openai: 3.0.64`, `@ai-sdk/openai-compatible: 2.0.47` to root catalog
- Updated `console/function` to use `catalog:` references for all three
- Note: opencode retains direct version pins for other `@ai-sdk/*` packages not used by console

---

## 10. [x] Low: Rename `identity/` → `brand/`

**Affected:** `packages/identity/` → `packages/brand/`, `index.md`

**Problem:** Contained only logo assets but named `identity/` suggesting auth code.

**Resolution:**
- Renamed directory: `packages/identity/` → `packages/brand/`
- Updated `index.md` folder map
- Verified no code references to `packages/identity/` exist (VSCode images are standalone copies)

---

## Implementation Summary

| # | Priority | Status | Item |
|---|----------|--------|------|
| 1 | CRITICAL | [x] | @solidjs/start pinned to 1.3.2 |
| 2 | CRITICAL | [x] | DOCINDEX.md + index.md created |
| 3 | HIGH | [x] | ghostty-web pinned to commit hash |
| 4 | HIGH | [x] | 4 silent catch blocks fixed |
| 5 | MEDIUM | [x] | Bus `any` types → `Payload` |
| 6 | MEDIUM | [x] | AGENTS.md: auto-gen code + TS version docs |
| 7 | MEDIUM | [x] | Test skeletons created (function, plugin, sdk) |
| 8 | MEDIUM | [x] | Bug resolution plan triaged with downgrade guide |
| 9 | MEDIUM | [x] | @ai-sdk/* versions added to catalog |
| 10 | LOW | [x] | identity/ → brand/ rename

---

## Notes

- `packages/console/core` wildcard exports: confirmed `"private": true` in package.json — no risk of external internal module exposure. No action needed.
- `nitro@3.0.1-alpha.1`: build-time Vite plugin only (not runtime). Lower risk than initially assessed. Marked as deferred until stable nitro 3.x release.
