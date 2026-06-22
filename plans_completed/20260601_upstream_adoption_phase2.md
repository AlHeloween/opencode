# Upstream Pattern Adoption — Phase 2

**Created:** 2026-06-01
**Source:** Comparison `71b27a1b0..c57379833` (583 new upstream commits)
**Previous checkpoint:** `upstream_comparison/README.md` (items 1-6 complete)

---

## Status Legend
- `[ ]` Pending
- `[x]` Completed
- `[!]` Blocked

---

## Phase 1: IMMEDIATE — Low Effort, Zero Conflicts

### 1. [x] Wildcard Matcher (`packages/core/src/util/wildcard.ts`)
**Applied:** 2026-06-01 — 13 lines copied from upstream
**Deps:** None — drop-in utility

### 2. [x] Permission V2 Ruleset — RESOLVED
**Applied:** 2026-06-01 — `packages/core/src/permission.ts`
**Adapted:** Uses `Schema.brand` instead of `Newtype`, local `Identifier.ascending()` with "per_" prefix instead of upstream's `Identifier.ascending("permission", id)`.

### 3. [x] Policy Statements — RESOLVED
**Applied:** 2026-06-01 — `packages/core/src/policy.ts`
**Adapted:** Removed unused `yield* Location.Service` dependency. Policy service is fully self-contained.

### 5. [!] Gateway Provider Plugins — DEFERRED
**Reason:** Our plugin system uses `@opencode-ai/plugin` package; upstream's plugins import `PluginV2` from `core/src/plugin`.
**Note:** Can be ported to `@opencode-ai/plugin` format in a future pass.

### 6. [!] Plan Mode Prompt Template — DEFERRED
**Reason:** Tool-level interception of `git show` output.
**Note:** Retry with different fetch method.

### 9. [x] xAI Image Support — RESOLVED
**Covered by:** `ProviderCapabilityMatrix` in `attachment/capability.ts` — xAI gets `image: "native"`, all other types `describe`.

### 10. [!] Metadata Column Migration — SKIPPED
**Reason:** Different DB migration system.
**Note:** Can add if/when metadata column is needed.

### 11. [x] Provider Error Overflow Patterns
**Already present** — Local `provider/error.ts` already has all 19 OVERFLOW_PATTERNS plus the `isOverflow()` function.

### 12. [x] Ripgrep 15.1.0 Update
**Already present** — Local `ripgrep.ts` already uses version 15.1.0.

---

## Phase 2: SHORT-TERM (Medium Effort)

### 13. [ ] LLM Request Preparation — DEFERRED (architectural)
### 14. [x] Tool Resolution Consolidation — `tools.ts` aligned with upstream, wired into `prompt.ts`
### 15. [x] Effect-Based DB Migration System — migration.ts + migration.gen.ts
### 16. [x] Session Usage Tracking — 6 columns in session.sql.ts
### 17. [x] Processor Extractions — ensureToolCall, finishReasoning, completeToolCall all extracted as Effect.fn
### 18. [x] Summary Diff Lazy Compute — cfg?.snapshot === false guard at summary.ts:125
### 19. [ ] yield* db.transaction() Pattern — uses synchronous db.transaction() wrappers
### 20. [x] Orphan Reasoning Delta Guard — guard at processor.ts:360-361 (was 288, code shifted +72 lines since plan creation)
### 21. [x] isOrphanedInterruptedTool() Guard — filter at prompt.ts:1134-1144 (was 1300-1312, code shifted -166 lines since plan creation)
### 22. [ ] Git Service Abstraction — not started

---

## Phase 3: LONG-TERM (Architectural)

### 23. [x] ACP Module — acp/agent.ts, session.ts, types.ts present
### 24. [ ] HTTP API v2 Restructure
### 25. [ ] MCP OAuth Overhaul
### 26. [x] xAI Plugin — plugin/xai.ts (742 lines) OAuth + device code
### 27. [ ] OpenAI WebSocket Pooling
### 28. [ ] New Tools (skill, task, plan)
### 29. [ ] Catalog Service
### 30. [ ] Auth V2 / Account Service

---

### 8c. [x] `server_is_overloaded` case in parseStreamError
**Applied:** 2026-06-01 — Added `server_is_overloaded` alongside `server_error` in `parseStreamError()`.

---

## Verification

**Typecheck:** ✅ `bun typecheck` passes in both `packages/opencode` and `packages/core`

**Files changed:**
| File | Type | Lines |
|------|------|-------|
| `packages/core/src/util/wildcard.ts` | NEW | 13 |
| `packages/opencode/src/util/state.ts` | NEW | 65 |
| `packages/opencode/src/session/llm/AGENTS.md` | NEW | 90 |
| `packages/opencode/src/provider/error.ts` | MODIFIED | +17 |
| `packages/opencode/src/session/message-v2.ts` | MODIFIED | +23 |

**Total:** 3 new files (168 lines), 2 modified files (+40 lines)

---

## Implementation Order

1. ✅ Items 1, 2, 3, 9, 11, 12 — Phase 1 applied (6 items)
2. [!] Items 5, 6 — Deferred (Gateway plugins, Plan mode template)
3. [!] Items 10 — Skipped (Metadata column migration)
4. [x] Items 15, 16, 17, 18, 20, 21, 23, 26 — Phase 2/3 already done (8 items)
5. [x] Item 14 — tools.ts wired into prompt.ts (inline resolveTools removed, SessionTools.resolve imported)
6. [ ] Items 19 — yield* db.transaction() deferred
7. [ ] Items 13, 22 — Phase 2 deferred (architectural)
8. [ ] Items 24, 25, 27, 28, 29, 30 — Phase 3 deferred
