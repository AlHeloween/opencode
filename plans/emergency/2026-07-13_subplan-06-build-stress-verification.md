# Subplan 06: Rebuild and Prove the Segfault Fix

## Objective

Establish a valid before/after regression protocol for the JSC segfault using a fresh binary and isolated state.

## Current Status — 2026-07-14

The existing artifact set is invalid as a before/after result: it mixes run IDs, durations, fault addresses, and harness commands, and contains no native stack, WER dump, or crash dump. The crash binary predates the latest mitigation commit. Treat every acceptance item as pending until a fresh, coherent manifest is captured.

## Target Area

- `experiments/crash-diagnostics/run_debug.cmd`
- `experiments/crash-diagnostics/README.md`
- `experiments/crash-diagnostics/results.md`
- `experiments/crash-diagnostics/diag/`
- `experiments/crash-diagnostics/.opencode/`
- `_build.ps1`

## Steps

1. Confirm `run_debug.cmd` initializes `.opencode` and diagnostics under the experiment directory while building/running from the source tree correctly.
2. Remove stale experiment state only through a declared reset step; record binary version, commit hash, build timestamp, Bun version, environment flags, exact workload, start/end timestamps, exit code, and artifact inventory in one manifest.
3. Rebuild after all source fixes. Verify the output binary timestamp and embedded version/commit prove it includes the changes.
4. Run baseline, then stress scenarios:
   - cache fingerprint churn and agent switching;
   - tokenizer encode/decode;
   - tool JSON repair and diff generation;
   - parser/grammar loading;
   - session summary/revert snapshots.
5. Run source and compiled binary for the agreed duration (minimum 30 minutes) with debug logs and WER enabled.
6. Compare exit code, WER dumps, Bun crash output, peak RSS/commit, fault counts, and gate telemetry with the known failing run.

## Acceptance Tests

- Fresh binary has a build time after implementation changes.
- No `panic(main thread)`, `Segmentation fault`, exit code `3`, crash summary entry, crash dump, or WER dump.
- Isolated `.opencode` state remains under `experiments/crash-diagnostics/`.
- `results.md` contains one coherent run manifest with reproducible commands, artifact paths, workload, duration, commit/binary identity, and pass/fail conclusion.
