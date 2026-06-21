# Plan Status Resolution Report

**Date:** Sun Jun 21 2026
**Method:** Compared all active plans against git commits, codebase inspection, and test execution

---

## Plans Ready for `plans_completed/` (Fully Implemented)

| Plan | Commit(s) | Verification |
|------|-----------|-------------|
| `20260611_prompt_frontmatter_model_matching.md` | `edd47dee3` | Frontmatter parsing in system.ts, all prompt .txt files have YAML frontmatter |
| `20260612_compaction_schema_diagram.md` | N/A (doc) | All verification items marked [x], architecture matches code |
| `20260612_remove_synthetic_tail.md` | `8a5bab8ae` | tail_count in CompactionPart, synthetic tail block removed, tests updated |
| `20260613_kv_cache_continuity_hardening.md` | `da89c7d` | Fingerprint after plugin hook, MD5(content) in cache-control, compaction fingerprint |
| `20260619_cache_shape_improvements.md` | `c9b813e1b` | PrefixShape, normalizeToolSchemas, component blame in auditCache, wired into prompt.ts |
| `20260620_cache_tests_tui.md` | `915b2d62a` | 18 Bun tests passing, cumulative cache stats in TUI context.tsx |
| `20260620_long_conversation_lag_fix.md` | `e72c0f1d4` | Cached msgs/tools/fingerprints, messagesSince(), fast compaction boundary check |
| `20260620_model_priority_and_cmd_runner_fix.md` | `44c754d43` | deepseek-v4-pro in priority list, 10min cmd_runner timeout |
| `20260621_insertReminders_idempotency.md` | `ed6cc37c1` | hasSynthetic() guard, idempotent pushes |

**Action:** Move these 9 files to `plans_completed/`.

---

## Plans Requiring Work Before Completion

### `20260605_preexisting_provider_git_init.md` — NOT IMPLEMENTED

Both tests still fail:
- `httpapi-provider.test.ts`: Times out at 5000ms (Effect.promise deadlock not fixed)
- `project-init-git.test.ts`: Assertion mismatch — test expects `{id: "global"}` but gets full project object

**Action:** Keep active. Requires code fix.

---

## Plans with Partial Implementation / Outstanding Items

### `20260601_complete_remaining_items.md` — Partially Implemented

**Done:**
- drizzle.config.ts (exists)
- isOrphanedInterruptedTool guard (prompt.ts:1113)
- EventV2Bridge + RuntimeFlags plugin layers (plugin/index.ts:297)
- ensureToolCall + finishReasoning processor extractions (processor.ts:259,284)
- Session usage tracking migration (processor.ts:450-504)

**NOT Done:**
- `toolResultOutput()` function — does not exist anywhere in codebase
- `yield* db.transaction()` pattern — still marked [ ] in upstream_adoption_phase2.md
- Git service abstraction — no git.ts in packages/core/src
- Summary diff lazy compute — not verified
- Orphan reasoning delta guard — not verified
- Tool resolution consolidation — not verified
- LLM request preparation module — not verified

**Action:** Keep active. Create sub-plan for remaining items.

### `20260621_date_compounding_in_loop_fix.md` — NEW, JUST FIXED

**Bug:** `environmentDate()` prepended to `firstText.text` on every loop iteration, compounding the prefix (10x in a long loop) and breaking KV cache stability on every turn.

**Fix:** Added `!firstText.text.startsWith(dateText)` guard at both injection sites (prompt.ts:1249 and prompt.ts:1474). Same idempotency pattern as `ed6cc37c1`.

**Oracle:** Typecheck passed, cache-control tests (18/18), compaction tests (41/41).

---

### `20260604_project_analysis_issues.md` — Partially Fixed

**Fixed:**
- setInterval cleanup in models.ts (.unref() added)

**NOT Fixed:**
- `toolResultOutput()` plan-to-code gap (same as 20260601)
- Windows path bug in ls.ts:91 — still uses `dir.split("/")`
- isNaN() vs Number.isNaN() in mcp/index.ts:447 and cli/cmd/stats.ts:337
- httpapi-provider and project-init-git tests (same as 20260605)
- cache-control.ts self-test block still present (plan 20260620 said remove it)

**Action:** Keep active. Several items overlap with 20260605.

---

## New Issues Found During Verification

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | `toolResultOutput()` referenced in plan but never implemented | 20260601 item 2.3 | High (plan-to-code gap) |
| 2 | Plan status markers missing | 20260601 has no [ ]/[x] checkboxes | Medium |
| 3 | Self-test block not removed | cache-control.ts:540-601 | Low |
| 4 | Windows path handling | ls.ts:91 uses `/` split on Windows | Medium |
| 5 | Global isNaN usage | mcp/index.ts:447, stats.ts:337 | Low |

---

## Summary

- **9 plans** ready to move to `plans_completed/`
- **1 plan** (20260605) needs implementation work — 2 tests still failing
- **2 plans** (20260601, 20260604) partially done — need cleanup of remaining items
- **5 new issues** identified for tracking
