# Reconcile: kernel-gated reopen + restore yanked plans

Created: 2026-08-28T04:42Z
Status: COMPLETED 2026-08-28T04:52Z — 16 files restored; kernel gate live-verified (reopenedToActive: [] on real worktree); typecheck PASS, plan-status tests 20/20 PASS (20260828T044639Z_ab42c76c)
Author: build_mode

## Goal

`reconcilePlans` reopened user-curated plans from `plans_completed/` back to
`plans/` because old plans carry loose unchecked boxes (deferred items). Gate
the reopen on kernel authorship markers; restore the yanked files.

## Tasks

### T1 — restore yanked plans [x]

- move every file my reconcile runs pulled back into `plans/` (D at
  plans_completed/ + matching untracked file at plans/) back to
  `plans_completed/`
- oracle: `git status --short -- plans plans_completed` shows no D+?? pairs
  for those files

### T2 — kernel-gated reopen [x]

- `isKernelAuthored(content)`: plan contains `<!-- workflow:` plan-tag or
  `<!-- sv:` task tags (kernel assembly markers)
- `hasOpenItems(f) && isKernelAuthored(f)` → misplaced/reopen (as today)
- open items WITHOUT kernel markers → user-curated: stay in
  `plans_completed/`, counted as completed; never auto-reopened
- oracle: `bun test test/util/plan-status.test.ts` PASS + typecheck PASS

## Smoke Tests

smoke_na: false
baseline:
- label: typecheck-pre
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun run typecheck"
  expected_exit: 0
  note: via cmd_runner
post_checks:
- label: typecheck-post
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun run typecheck"
  expected_exit: 0
- label: plan-status-tests
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun test test/util/plan-status.test.ts"
  expected_exit: 0
- label: plans-dirs-clean
  cmd: git status --short -- plans plans_completed
  expected_exit: 0
  note: manual review — yanked files restored

blast_radius: util/plan-status.ts (reopen gate + completed filter), one restore
pass over plans directories. Tests updated to new contract.

## Outcome Contract

acceptance_criteria:
- id: AC1 — non-kernel plans in plans_completed/ are never auto-reopened
  oracle_cmd: bun test test/util/plan-status.test.ts
  expected_result: PASS
- id: AC2 — yanked files restored to plans_completed/
  oracle_cmd: git status --short -- plans plans_completed (manual review)
  expected_result: PASS
coverage_threshold: 1.0
critical_risks: []
