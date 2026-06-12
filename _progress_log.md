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

## 2026-06-08 Portable Continue Command

Reason: the TUI exit banner printed `opencode -s <session>`, but a copied portable bundle launched from `bin_tst\\tst3` needs `bin\\opencode.exe -s <session>` so the user does not accidentally run a different `opencode` from `PATH`.

Changes:

- Updated `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` to derive the continue command from the current executable instead of hardcoding `opencode`.
- Added command-path quoting for paths with shell-sensitive characters.
- Rebuilt the portable binary and copied it into `bin_tst\\tst3\\bin\\opencode.exe` for runtime verification.

Script output:

- `bun typecheck` from `packages/opencode`: passed (`cmd_runner` run `20260608T015744Z_ffa4700e`).
- `_build.ps1`: passed, smoke test version `10.0.100` (`cmd_runner` run `20260608T015813Z_c736b7a2`).
- Absolute portable invocation restored reported session `ses_15b15261fffe3zPa4pCOPoSrpM` (`cmd_runner` run `20260608T020116Z_d2bedc6d`).
- Exit banner printed `Continue bin\\opencode.exe -s ses_15b15261fffe3zPa4pCOPoSrpM` (`cmd_runner` run `20260608T020116Z_d2bedc6d`).
- Exact displayed command through `cmd.exe` restored the session and exited cleanly (`cmd_runner` run `20260608T020231Z_7a7f6fde`).
- Direct `cmd_runner` argv execution of relative `bin\\opencode.exe` is not equivalent to a user `cmd.exe` prompt and reproduced `Session not found`; that diagnostic run was stopped (`cmd_runner` run `20260608T020146Z_1b34a5e0`).

## 2026-06-08 Document Read Conversion

Reason: reading non-empty PDF/DOCX/PPTX files from `artifacts/` returned empty content because `convertDocument()` could not resolve `opencode-markdownify` and returned an empty string on failure.

Changes:

- Updated `packages/opencode/src/util/markdownify.ts` to search the real executable directory, executable-adjacent config directory, project `bin`, cwd `bin`, and source-checkout `bin` before development `dist` fallbacks.
- Updated `packages/opencode/src/util/markdownify.ts` to throw a clear document conversion error when the converter is missing or exits non-zero.
- Updated `packages/opencode/src/tool/read.ts` to classify `.pdf` as binary and reject binary bytes in text-like extensions instead of converting them through markdownify.
- Updated `packages/opencode/src/tool/read.ts` to resolve Windows drive-less absolute paths against the active project drive before read permission/stat checks.

Script output:

- `bun typecheck` from `packages/opencode`: passed (`cmd_runner` run `20260608T144234Z_74fcce27`).
- `convertDocument()` against all files in `artifacts/`: non-empty output for `Методические указания по курсовому проекту.pdf`, `Основные требования.pptx`, `Примерное содержание раздела Тестирование.docx`, and `Титульный лист.docx`.
- `bun test --timeout 30000 -t "rejects text extension files with null bytes" test/tool/read.test.ts`: passed, 2 pass, 126 filtered out (`cmd_runner` run `20260608T143539Z_205c3467`).
- `bun test --timeout 30000 test/tool/read.test.ts`: passed, 37 pass (`cmd_runner` run `20260608T144234Z_5dafabe4`).

## 2026-06-12 Provider Max Output Cap

Reason: qwen-like model metadata can report native output equal to the full context window, causing provider requests to send an impossible `max_tokens` value when input tokens are also present.

Changes:

- Updated `packages/opencode/src/provider/transform.ts` so `ProviderTransform.maxOutputTokens()` preserves explicit overrides and normal native limits, but caps pathological `output >= context` metadata to a context reserve.
- Added focused `ProviderTransform.maxOutputTokens()` regression tests in `packages/opencode/test/provider/transform.test.ts`.
- Updated `plans/20260612_cap_pathological_max_output_tokens.md` and `_development_plan.md` with completed verification.

Script output:

- `bun test --timeout 30000 test/provider/transform.test.ts`: passed, 148 pass (`cmd_runner` run `20260612T074312Z_c0e85514`).
- `bun typecheck`: passed (`cmd_runner` run `20260612T074327Z_7d464663`).

## 2026-06-12 Qwen Request Cap Verification

Reason: confirm the qwen/openai-compatible LLM request path sends a capped provider `max_tokens` value when model metadata reports native output equal to context.

Changes:

- Added a qwen-like request-body regression test in `packages/opencode/test/session/llm.test.ts` using the existing `alibaba/qwen-plus` fixture with an in-memory `output == context` override.
- Verified the mock HTTP capture receives `max_tokens == 20000` and less than the model context window.
- Updated `plans/20260612_qwen_request_cap_e2e_verification.md` and `_development_plan.md` with completed verification.

Script output:

- `bun test --timeout 30000 test/session/llm.test.ts -t "caps max_tokens for qwen-like"`: passed, 3 pass, 178 filtered, 0 fail (`cmd_runner` run `20260612T075720Z_e5b7a91e`).
- `bun typecheck`: passed (`cmd_runner` run `20260612T075744Z_64d9ca27`).
