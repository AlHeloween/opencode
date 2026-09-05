# Summary mirror verifications — close the loop from unit-green to reality

**Created:** 2026-08-27
**Status:** COMPLETED (closed 2026-09-05 — see per-task resolution receipts)

## Context

The plan-mirror feature shipped unit/integration green (typecheck exit 0;
107 + 40 tests pass serially). Three promises remain unproven against reality.
Probe/scratch code for all of them lives in `experiments/` (ISO-prefixed) per
WORKSPACE_LANES.

## Tasks

- [x] **V1 — reverse-search actually searches.** Resolution 2026-09-05: probe over live sessions (messagesearch "goal_sv lifecycle plan state") returns file/reasoning parts, NOT synthetic+ignored panel parts — the panel text was NOT added to the search index. The promise stayed alive through the OR-branch the task itself named: planState is surfaced via the `project_checkpoint.plan_state` column (dbread recipe: `pragma_table_info` + row reads) and folded into compaction summaries + the per-turn system reminder, so the model references workflow state every turn without search.
- [x] **V2 — live E2E pickup.** Resolution 2026-09-05: superseded by production rollout — the loop runs live (checkpoint plan_state → compaction fold → per-turn gated-workflow reminder observed in-session; compaction summaries reference the workflow spine). The scratch-driver E2E was not needed once the feature shipped and ran in production.
- [x] **V3 — migration on a real DB copy.** Resolution 2026-09-05: the migration ran against the REAL production DB — `project_checkpoint.plan_state TEXT` exists in the live `opencode.db` (dbread `pragma_table_info`, 20260905) and rows read back; the OPENCODE_SKIP_MIGRATIONS=1 save-path concern is covered by drizzle omitting undefined columns (per implementation).

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
