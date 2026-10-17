<!-- intention: shared tree holds only named-owner work, every plan sits where its boxes say it belongs — recorded in git, not in a filesystem rename -->
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

- [ ] T1 — B6 verdict from evidence. Candidate receipts: `cc84e46096` (edit + tests), `d0f9c04d1b`
  (install run `20261015T025937Z_307a3929`, post-install pytest 285 passed, readback x4, `_build.ps1` exit 0),
  the three mutation controls in `prompt_kernel/tests/test_reward_restoration.py`, installed receivers
  (`reasoning_prompt.txt:239`, `reasoning_kernel.md:239`). Re-run
  `python -m pytest prompt_kernel/tests/test_reward_restoration.py -q` via cmd_runner. B6 names 67 000;
  t79 raised to 68 000 (`source.py:967`, `validate.py:240`) — say so in the receipt, do not rewrite history.
  Tick B6 in the kernel plan with receipts if DONE; else state what is missing and leave it open.
- [ ] T2 — Half-moves. Each plan: every box ticked (git-tmpdir S6 [x]; host-crash S1–S6 [x]), blob-identical
  to `HEAD:plans/<name>` (hashes above). host-crash root cause stays Unknown — recorded as residual
  (R-S1 candidates + R-S4/S5 residual lines), all S-box oracles permit it (S1 honest-Unknown allowance),
  so the move is not premature. Record the renames in git (`git show --stat` prints
  `{plans => plans_completed}`); an open box would go back to `plans/` instead.
- [ ] T3 — Owners of uncommitted files, READ ONLY. For every `git status --short` path not covered by T1–T2:
  author (session id + lane) + evidence line + recommendation (its owner commits it / orphan → owner decides /
  scratch). Sources: Claude transcripts, robot DB `part` rows, Codex sessions, `_progress_log.md`, mtimes.
  Table → `experiments/2026-10-17_tree-ownership/REPORT.md`. Nothing committed, moved or deleted here.

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
