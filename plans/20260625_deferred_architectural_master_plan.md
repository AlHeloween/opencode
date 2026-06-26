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
| E1 | Background Job Fixes | `plans_completed/20260625_background_job_fixes.md` | 1-2 days | [x] Done |
| E2 | Orchestrator Agent + AGI Mode | `plans_completed/20260625_orchestrator_agent_agi_mode.md` | 4 days | [x] Done |

### Priority Tasks (`plans/priority/` — execute second)

| ID | Item | Plan File | Effort | Status |
|----|------|-----------|--------|--------|
| P1 | Config Consolidation | `plans_completed/20260625_config_consolidation.md` | 9.5 days | [x] Done |
| P2 | Cache Stats — Per-Message | `plans_completed/20260625_cache_stats.md` | 3.5 days | [x] Done |

### Standard Tasks (`plans/`)

| ID | Item | Plan File | Effort | Priority | Status |
|----|------|-----------|--------|----------|--------|
| 4.4 | Catalog Service | `plans_completed/20260625_catalog_service_plan.md` | 8-12 days | High | [x] Done |
| 4.5 | Auth V2 | `plans_completed/20260625_auth_v2_plan.md` | 15-19 days | High | [x] Done |
| 4.6 | PluginV2 Rename | `plans_completed/20260625_pluginv2_rename_plan.md` | 1 day | Medium | [x] Done |
| 4.1 | FTS Trigger Migration | `plans_completed/20260625_fts_trigger_migration_plan.md` | 1 day | Low | [x] Done |
| 4.2 | Inline SQL Cleanup | `plans_completed/20260625_inline_sql_cleanup_plan.md` | 3-5 days | Low | [x] Done |
| 4.3 | HTTP API v2 | `plans/20260625_http_api_v2_plan.md` | 2-4 weeks | Medium | [ ] Planned |
| C1 | Conversation Checkpoint | `plans_completed/20260624_checkpoint_plan.md` | 6-8h | High | [x] Done |
| E3 | Orchestrator Evolving Mode | `plans/emergency/20260626_orchestrator_evolving_mode.md` | 1-2 days | High | [ ] Planned |

## Recommended Execution Order

```
Phase 0 (Emergency — done):
  [x] E1 Background Job Fixes
  [x] E2 Orchestrator Agent + AGI Mode

Phase 1 (Priority — done):
  [x] P1 Config Consolidation (9.5 days)

Phase 2 (In Progress):
  Day 1:    E3 Orchestrator Evolving Mode (1-2 days)

Phase 3 (Foundation):
  Days 1-12: 4.4 Catalog Service (8-12 days)
  Day 13:    4.6 PluginV2 Rename (1 day, unblocked by 4.4 completion)

Phase 4 (Integration):
  Days 1-10: 4.5 Auth V2 (7-10 days)

Phase 5 (Large restructuring):
  Days 1-20: 4.3 HTTP API v2 (2-4 weeks)
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
- Completed plans: 88 in `plans_completed/`
- Active plans: 7 (this master + 6 item plans: catalog, auth-v2, http-api-v2, pluginv2-rename, checkpoint, orchestrator-evolving, config-consolidation)

## Revisions

| Date | Change |
|------|--------|
| 2026-06-25 | Initial master plan with 6 items, all explorer-validated |
| 2026-06-25 | Added 2 priority plans (P1 Config Consolidation, P2 Cache Stats). Revised Auth V2 plan: removed env var injection, added auth.enc exclusive + server auth → opencode.jsonc. |
| 2026-06-26 | Marked 4.1, 4.2, P2 as done (moved to plans_completed/ 2026-06-25, master stale). Added C1 (Checkpoint Plan) and E3 (Orchestrator Evolving Mode) to tracking. Added hardening rule 10 (reference grounding) to reasoning.txt and AGENTS.md Plan Maintenance to prevent recurrence. |
