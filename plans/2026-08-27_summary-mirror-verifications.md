# Summary mirror verifications — close the loop from unit-green to reality

**Created:** 2026-08-27
**Status:** DRAFT (follows plans_completed/2026-08-27_summary-plan-mirror.md)

## Context

The plan-mirror feature shipped unit/integration green (typecheck exit 0;
107 + 40 tests pass serially). Three promises remain unproven against reality.
Probe/scratch code for all of them lives in `experiments/` (ISO-prefixed) per
WORKSPACE_LANES.

## Tasks

- [ ] **V1 — reverse-search actually searches.** Does `messagesearch` index
  `synthetic+ignored` text parts (the LAYER-1 panel where plan-state strings
  live)? If not — the «task sv → messagesearch → s row» promise is dead on the
  search side. Probe: seed a fixture session with a panel message, query
  messagesearch for a task sv string. Failure path: include panel text in the
  search index (or surface planState via dbread query recipe in docs).
- [ ] **V2 — live E2E pickup.** Real LLM session: drive content ≥ cadence →
  sidecar capture → assert project_checkpoint row carries `plan_state` →
  compact → assert m* contains spine/lifecycle/task-sv strings → model turn
  references the workflow state. Scratch driver in `experiments/`.
- [ ] **V3 — migration on a real DB copy.** Copy the live worktree DB, apply
  migrations (`apply()` path), verify `ALTER TABLE project_checkpoint ADD
  COLUMN plan_state` succeeds and prior rows read back with planState=undefined.
  Also verify `OPENCODE_SKIP_MIGRATIONS=1` path: save() with planState=undefined
  must not emit the column (drizzle omits undefined).

## Smoke Tests

- baseline: current tree typecheck exit 0 + 107/40 test passes (receipts
  20260827T223326Z_0e879bb5, 20260827T223842Z_ff4624c8)
- post: same set after any probe-driven fix
- blast_radius: search indexing (V1), experiments/ only for drivers, no product
  edits unless a probe proves a gap (then revise this plan per PLAN_REVISION).

## Premises

- Panel parts are stored synthetic+ignored (compaction.ts display path) — Exact.
- messagesearch index behavior over ignored parts — **Unknown** (V1's reason to exist).
- Migration runner applies pending id-ordered migrations with tracking table — Exact (storage/migration.ts).
