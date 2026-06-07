# Progress Log

## 2026-06-04 Cache Collapse And Stream Stall Recovery

Reason: fix DeepSeek/Anthropic prompt-cache collapse detection, prevent cache-poison loop blocking, notify users, and add conservative pre-tool stream stall recovery.

Changes:

- Updated `packages/opencode/src/session/processor.ts` with input-delta collapse detection, rebaseline signaling, and stream stall timeout handling.
- Updated `packages/opencode/src/session/prompt.ts` to consume rebaseline signals and auto-continue pre-tool stalls.
- Updated `packages/opencode/src/session/compaction.ts` to map stalled compaction streams to stop.
- Updated `packages/opencode/src/session/session.ts` with `Session.Event.CacheCollapsed`.
- Updated `packages/opencode/src/provider/transform.ts` to include DeepSeek in cache marker application.
- Updated `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` to show cache-collapse toasts.
- Regenerated SDK event type surface for `session.cache_collapsed`.
- Updated plans under `plans/`.

Script output:

- `bun typecheck`: passed.
- `bun test test/session/processor-effect.test.ts --test-name-pattern "cache poison|input delta|cold start"`: 6 passed.
- `bun test test/provider/transform.test.ts`: 143 passed.

Notes:

- Dedicated runtime watchdog tests remain pending because existing LLM-server live tests in `processor-effect.test.ts` time out in this environment.

## 2026-06-07 Remove Watchdog And Cache-Control Side Effects

Reason: finish cleanup of automatic stream-stall and prompt-cache control-flow behavior, remove the processor scratch `MessageTable` dual-write, and keep cache handling passive.

Changes:

- Updated `packages/opencode/src/session/processor.ts` so cleanup persists through `session.updateMessage()` only.
- Moved `plans/20260606_remove_watchdog_cache_side_effects.md` to `plans_completed/20260606_remove_watchdog_cache_side_effects.md` after plan validation passed.
- Updated `_application_workflow_diagram.md` to remove stale stalled/cache-collapse workflow descriptions.

Script output:

- `bun test --timeout 30000 test/session/processor-effect.test.ts -t "record aborted errors and idle state"`: passed, 1 pass, 24 filtered out (`cmd_runner` run `20260607T080950Z_a55468aa`).
- `bun typecheck`: passed (`cmd_runner` run `20260607T081202Z_c3fcbf85`).
- `bun test --timeout 30000 test/session/compaction.test.ts`: passed, 48 pass (`cmd_runner` run `20260607T081202Z_05d9ac2c`).

## 2026-06-07 Runtime Path And Project DB Routing

Reason: `bin_tst\tst2\bin` contained executable-adjacent `.opencode\data` artifacts, and `tst2` project data was routed to the parent repo DB when discovery walked up to `D:\zPython\opencode\.git`.

Changes:

- Updated `packages/core/src/global.ts` so pre-worktree data/cache/state/log/bin paths start at the launch working directory instead of the executable directory.
- Updated `packages/opencode/src/project/project.ts` so a local opencode project DB/config file creates a project boundary before parent git discovery.
- Updated `packages/opencode/src/project/project.ts` so `dir\\bin\\opencode.json` and `dir\\bin\\opencode.jsonc` create a boundary for portable bundles launched from `dir`.
- Updated `packages/opencode/src/project/project.ts` so non-git and no-commit fallback projects use stable path-derived IDs instead of `ProjectID.global`.
- Removed config-level SQLite `account.db` creation and the unused opencode account/account_state project schema.
- Replaced `AccountRepo` persistence with process-local in-memory state for experimental console account routes.
- Added/updated tests in `packages/core/test/global.test.ts` and `packages/opencode/test/project/project.test.ts`.
- Fixed `_build.ps1` PowerShell 5 path joins so the portable bundle build completes.

Script output:

- `bun test --timeout 30000 test/project/project.test.ts`: passed, 38 pass (`cmd_runner` run `20260607T172739Z_0b43b725`).
- `bun test --timeout 30000 test/global.test.ts`: passed, 1 pass (`cmd_runner` run `20260607T095003Z_a1f469e3`).
- `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts`: passed, 26 pass (`cmd_runner` run `20260607T143800Z_18177818`).
- `bun test --timeout 30000 test/server/httpapi-experimental.test.ts`: passed, 3 pass, 1 skip (`cmd_runner` run `20260607T143800Z_6e017afb`).
- `bun typecheck`: passed (`cmd_runner` run `20260607T143800Z_421139e7`).
- `bun typecheck`: passed after the portable boundary fix (`cmd_runner` run `20260607T172739Z_642b7319`).
- `pwsh _build.ps1`: passed and produced version `10.0.98` (`cmd_runner` run `20260607T172921Z_c0f5d996`).
- Fresh portable launch from `bin_tst\\tst3`: prompt `2+2?` returned `4`; logs opened `bin_tst\\tst3\\.opencode\\data\\opencode.db`; no `bin\\account.db` or `bin\\.opencode` was created (`cmd_runner` run `20260607T173159Z_24d85141`).
- Restore-oriented relaunch from `bin_tst\\tst3`: logs reused project ID `c0e7496c66ae89d0c28c5d036a623b3f356c7761` and the same project DB (`cmd_runner` run `20260607T173918Z_cb0a119e`).

Final verification update:

- Initial final verification commands without `--shell cmd` produced PowerShell payload quoting errors in `cmd_runner`; those runs are not counted as valid verification evidence.
- `bun typecheck` from `packages/opencode`: passed (`cmd_runner` run `20260607T175919Z_f8978a24`).
- `bun typecheck` from `packages/core`: passed (`cmd_runner` run `20260607T175919Z_ff26610b`).
- `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts` from `packages/opencode`: passed, 26 pass (`cmd_runner` run `20260607T175919Z_7fb55528`).
- `bun test --timeout 30000 test/server/httpapi-experimental.test.ts` from `packages/opencode`: passed, 3 pass, 1 skip (`cmd_runner` run `20260607T175919Z_4bbad0bf`).
- `bun test --timeout 30000 test/global.test.ts` from `packages/core`: passed, 1 pass (`cmd_runner` run `20260607T175920Z_7f356544`).
- `bun test --timeout 30000 test/project/project.test.ts -t importFromDisk` from `packages/opencode`: passed, 3 pass, 35 filtered out (`cmd_runner` run `20260607T180249Z_61dcaddd`).
- `bun test --timeout 30000 test/project/project.test.ts` from `packages/opencode` hung before test output and was stopped (`cmd_runner` runs `20260607T175919Z_e92432da`, `20260607T180127Z_1665f17a`). The earlier full project suite pass after the boundary fix remains the valid full-suite evidence for this code path (`cmd_runner` run `20260607T172739Z_0b43b725`).
- `bun test --timeout 30000 test/project/project.test.ts -t "uses parent directory boundary when config lives in child bin"` hung before test output and was stopped (`cmd_runner` run `20260607T180249Z_6bd2d15f`).
- Runtime directory search found no `account.db` under `.opencode`, `bin`, `dist`, or `bin_tst`.
