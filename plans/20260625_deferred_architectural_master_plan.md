---
status: planned
owner: codex
created: 2026-06-25
reproduce:
  - cd packages/opencode && bun typecheck
  - plans/ validated by explore agent against codebase
---

# Deferred Architectural Items — Master Implementation Plan

## Goal

Complete the 6 remaining deferred architectural items from the `20260623_remaining_items.md` audit. These are not bugs — they work correctly today — but represent design improvements for long-term maintainability.

## Items and Dependencies

```
                                    ┌─────────────────────┐
                                    │  4.4 Catalog Service │ ← foundation; blocks PluginV2 rename
                                    └──────────┬──────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────┐
                    │                          │                      │
                    v                          v                      v
    ┌───────────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
    │ 4.6 PluginV2 Hook Rename  │  │ 4.5 Auth V2          │  │ (provider/model) │
    │ provider.update → catalog │  │ Account integration   │  │ resolution path  │
    │ blocked: Catalog adoption │  │ independent of Cat   │  │ unified by Cat   │
    └───────────────────────────┘  └─────────────────────┘  └──────────────────┘

Independent items (no blocking dependencies):
┌─────────────────────────────────────┐
│ 4.1 FTS Trigger Migration           │ ← schema management cleanup
│ Work: 1 day, 5 tests                │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 4.2 Inline SQL Cleanup              │ ← code quality improvement
│ Work: 3-5 days, 8 tests             │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 4.3 HTTP API v2 Restructure         │ ← deduplication + versioning
│ Work: 2-4 weeks                     │
└─────────────────────────────────────┘
```

## Task Summary

### Emergency Tasks (`plans/emergency/` — fix first)

| ID | Item | Plan File | Effort | Status |
|----|------|-----------|--------|--------|
| E1 | Background Job Fixes | `plans/emergency/background_job_fixes.md` | 1-2 days | [ ] Planned |
| E2 | Orchestrator Agent + AGI Mode | `plans/emergency/orchestrator_agent_agi_mode.md` | 4 days | [ ] Planned |

### Priority Tasks (`plans/priority/` — execute second)

| ID | Item | Plan File | Effort | Status |
|----|------|-----------|--------|--------|
| P1 | Config Consolidation | `plans/priority/config_consolidation.md` | 9.5 days | [ ] Planned |
| P2 | Cache Stats — Per-Message | `plans/priority/cache_stats.md` | 3.5 days | [ ] Planned |

### Standard Tasks (`plans/`)

| ID | Item | Plan File | Effort | Priority | Status |
|----|------|-----------|--------|----------|--------|
| 4.4 | Catalog Service | `plans/20260625_catalog_service_plan.md` | 8-12 days | High | [ ] Planned |
| 4.5 | Auth V2 | `plans/20260625_auth_v2_plan.md` | 15-19 days | High | [ ] Planned |
| 4.6 | PluginV2 Rename | `plans/20260625_pluginv2_rename_plan.md` | 1 day | Medium | [ ] Blocked by 4.4 |
| 4.1 | FTS Trigger Migration | `plans/20260625_fts_trigger_migration_plan.md` | 1 day | Low | [ ] Planned |
| 4.2 | Inline SQL Cleanup | `plans/20260625_inline_sql_cleanup_plan.md` | 3-5 days | Low | [ ] Planned |
| 4.3 | HTTP API v2 | `plans/20260625_http_api_v2_plan.md` | 2-4 weeks | Medium | [ ] Planned |

## Recommended Execution Order

```
Phase 0 (Emergency — fix first):
  Days 1-2: E1 Background Job Fixes (TUI corruption + no output + concurrency cap)

Phase 1 (Priority — new):
  Days 1-10: P1 Config Consolidation (9.5 days) — blocks env var removal in other plans
  Days 11-14: P2 Cache Stats (3.5 days) — independent of config consolidation

Phase 1 (Quick wins):
  Day 1:    4.1 FTS Trigger Migration (1 day)
  Days 2-6: 4.2 Inline SQL Cleanup (3-5 days)
  
Phase 2 (Foundation):
  Days 7-18: 4.4 Catalog Service (8-12 days)
  Day 19:    4.6 PluginV2 Rename (1 day, unblocked by 4.4 completion)
  
Phase 3 (Integration):
  Days 20-29: 4.5 Auth V2 (7-10 days)
  
Phase 4 (Large restructuring):
  Days 30-49: 4.3 HTTP API v2 (2-4 weeks)
```

## Oracle Gates

Each item is complete when:
- Typecheck passes with zero errors
- All new tests pass
- Existing tests continue passing (no regressions)
- Plan document moved to `plans_completed/`

## Current State

- Working tree: clean
- Typecheck: zero errors
- Tests: all passing
- Completed plans: 85 in `plans_completed/`
- Active plans: 6 (this master + 5 item plans)

## Revisions

| Date | Change |
|------|--------|
| 2026-06-25 | Initial master plan with 6 items, all explorer-validated |
| 2026-06-25 | Added 2 priority plans (P1 Config Consolidation, P2 Cache Stats). Revised Auth V2 plan: removed env var injection, added auth.enc exclusive + server auth → opencode.jsonc. Reasoning confirmed correct — no stripping needed. |
