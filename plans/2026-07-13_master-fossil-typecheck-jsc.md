# Emergency Master Plan: Fossil Migration, Typecheck, and JSC Stability

## Goal

Restore a clean, fully tested Fossil-based internal snapshot architecture; remove stale internal Git/JJ/Worktree assumptions; restore zero-error typechecking; and establish an evidence-backed mitigation for the Bun/JSC access violation in build `10.0.470` without claiming an unproven single cause.

## Evidence

- The captured terminal proves a native Bun Canary `1.4.0` main-thread segmentation fault at `0xC6720AA2`, with peak RSS below 1 GB; this is not an OOM.
- The diagnostic directory conflates distinct runs: `results.md` records another run ID, duration, and fault address, while the run log records a 2m28s run. No native stack, WER dump, or crash dump was captured.
- The compiled binary that crashed predates `725e438ce1`; no post-commit reproduction has been run.
- `SnapshotFossil` provides production snapshot consumers, but diagnostics repeatedly record `fossil open failed`, automatic reinitialization, and failed tracking commits. Fossil reports an out-of-sync local checkout database against the root snapshot repository.
- `bun typecheck` from `packages/opencode` currently fails with 103 diagnostics: 102 OpenTUI TS4114 errors and one TS2451 duplicate tree-sitter declaration.

## Current Status — 2026-07-14

All subplans complete except 06 (build stress) and 08 (snapshot-race). Testing convention: TS source with debug output first, build only after all TS tests pass (see `plans/README.md`).

| Subplan | Status | Completed |
|---------|--------|-----------|
| 01 Fossil migration | ✅ Complete | 7/7 steps |
| 02 Test coverage | ✅ Complete | 7/7 steps |
| 03 Typecheck | ✅ Complete | 103→0 diagnostics |
| 04 Cache hash | ✅ Complete | 5/6 steps (DB columns kept for compat) |
| 05 WASM gate | ✅ Complete | 4/6 steps (telemetry deferred) |
| 06 Build stress | ⏳ Remaining | Launch TUI via `cmd_runner` + `bun run --conditions=browser packages/opencode/src/index.ts` + `--log-level DEBUG --print-logs`. Send prompts: 2+2, delegate explore agent, edit undo/redo, tool calls. Verify all function. Binary build only after all TS tests pass. |
| 07 rg/fd removal | ✅ Complete | 14 files, 4 phases |
| 08 Snapshot race | ⏳ Active | Config.Service isolation fix — `plans/20260714_fix_snapshotfossil_config_isolation.md`. **Dependency**: snapshot = undo/redo foundation. If undo/redo broken, snapshot is the root cause. If snapshot test (race) fails, undo/redo will fail. Fix order: 08 → 06 (TUI undo/redo verify). |

## Original Status (preserved for history)

- Subplan 01 was **in progress**: layer wiring is migrated, but the Fossil checkout lifecycle was failing.

## Scope Boundaries

- Keep agent-facing Git behavior: branch/diff context, `git show`, GitHub/PR tools, and Git CLI tests where they exercise user-facing behavior.
- Replace only internal snapshot/worktree infrastructure with Fossil.
- Do not disable strict typechecking, add broad `skipLibCheck`, or suppress errors globally.
- Do not delete a test merely because its old dependency disappeared; migrate it to a current behavior test or record an approved feature retirement.

## Execution Order

1. `2026-07-13_subplan-01-fossil-layer-migration.md`
2. `2026-07-13_subplan-02-test-coverage-migration.md`
3. `2026-07-13_subplan-03-opentui-typecheck.md`
4. `2026-07-13_subplan-04-cache-hash-wasm.md`
5. `2026-07-13_subplan-05-wasm-memory-gating.md`
6. `2026-07-13_subplan-06-build-stress-verification.md`

## Global Acceptance Gates

- `bun typecheck` from `packages/opencode` has zero diagnostics.
- All migrated Fossil snapshot and relevant session tests pass from `packages/opencode`.
- A freshly rebuilt `bin/opencode.exe` contains the changes under test.
- A single-run manifest ties the exact binary, commit, start/end timestamps, workload, and every crash artifact together.
- The isolated `experiments/crash-diagnostics/run_debug.cmd` run has no Bun panic, WER dump, crash report, or non-zero exit during the agreed stress duration.
- Fossil tracking has no open/reinitialization/failed-commit loop and never resolves an isolated worktree through an ancestor checkout.
- Agent-facing Git behavior remains functional and is covered separately from Fossil snapshot behavior.
