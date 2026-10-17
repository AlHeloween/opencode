<!-- intention: tree with unnamed work and filesystem half-moves -> every path has a named owner and every plan sits where its boxes say, recorded in git, not in a filesystem rename -->
<!-- goal_sv:
Keywords: tree-hygiene 0.35, named-owner 0.25, git-rename 0.20, b6-receipt 0.20
Semantic dominant: Закрыть B6 с квитанциями, оформить полупереезды через git и назвать хозяев незакоммиченного.
md5: a1b2c3d4e5f60718293a4b5c6d7e8f90
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t80 — plan tree hygiene: close B6, finish two half-moves in git, name every uncommitted owner

Owner brief 2026-10-17 (Legislator lane; Smit executes): start from Claude's ділянка — close B6 with receipts,
commit the half-moves via `git mv`, find the owners of uncommitted files. No `bin/`, no kernel source edits,
no file outside the binding (the three plan files, this plan, the report, `_progress_log.md`,
`plans/MASTER_PLAN.md`). This task builds nothing, so `_build.ps1` is not required.

## Ground (G1)

- `plans/2026-10-15_kernel-continuation-without-blocked.md` (worktree) is byte-identical to
  `HEAD:plans_completed/2026-10-15_kernel-continuation-without-blocked.md` (blob 355348a9); box B6 still
  `- [ ]` while commit `0e3c4d693f` says «B1-B6 closed» — a pure-rename commit that moved the plan with B6 open.
- `plans_completed/2026-10-16_git-tmpdir-ceiling.md` == `HEAD:plans/2026-10-16_git-tmpdir-ceiling.md`
  (blob 3315da69); `plans_completed/2026-10-17_host-crash-nemotron.md` ==
  `HEAD:plans/2026-10-17_host-crash-nemotron.md` (blob 69f5db45) — filesystem renames, never git.
- Rename mechanism (not fixed here — queued task `reconcile-move-in-git`):
  `movePlanFile` (`packages/opencode/src/util/plan-status.ts:782`, `renameSync` at :786),
  driven by `reconcilePlans` (:794, call sites :822/:837).

## Tasks

- [x] T1 — B6 verdict from evidence: DONE. Receipts `cc84e46096` + `d0f9c04d1b`; re-run `test_reward_restoration.py` 39 passed (run `20261017T103827Z_d060584c`, exit 0); receivers carry the term (`reasoning_prompt.txt:239`, `reasoning_kernel.md:239`); ceiling note 67_000 → 68_000 (t79) kept as history. B6 ticked in `plans_completed/…kernel-continuation-without-blocked.md`, committed `86736222`. <!-- sv: b6-receipt 0.60, pytest-rerun 0.25, ceiling-note 0.15 -->
- [x] T2 — Half-moves recorded as git renames: both plans all-boxes-ticked and blob-identical to HEAD; `git diff HEAD^ HEAD --summary` prints `rename {plans => plans_completed}/…` (100%) ×2; commit `86736222`. host-crash Unknown root cause is a recorded residual, move not premature. <!-- sv: git-rename 0.60, all-boxes-ticked 0.25, residual-recorded 0.15 -->
- [x] T3 — Ownership table written READ ONLY to `experiments/2026-10-17_tree-ownership/REPORT.md`: 12 Exact + 14 Inferred + 3 Unknown (idawilli skill, docs/README link, MASTER_PLAN renderer → owner decides). Nothing committed, moved or deleted. <!-- sv: named-owner 0.50, exact-receipts 0.30, orphan-decision 0.20 -->

## Smoke Tests

- S1: `python -m pytest prompt_kernel/tests/test_reward_restoration.py -q` → 39 passed, exit 0
  (run `20261017T103827Z_d060584c`, `state.json` status finished, `bytes_written` 1065, `bytes_dropped` 0).
- S2: `git show --stat HEAD` after the T1–T2 commit prints two `{plans => plans_completed}` renames
  plus the kernel-plan modify; `git status --short` no longer lists the three plan paths.
- S3: REPORT.md names every non-T1–T2 status path with session id + evidence line.

```yaml
Keywords: tree-hygiene 0.35, named-owner 0.25, git-rename 0.20, b6-receipt 0.20
Semantic dominant: Закрыть B6 с квитанциями, оформить полупереезды через git и назвать хозяев незакоммиченного.
md5: a1b2c3d4e5f60718293a4b5c6d7e8f90
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```
