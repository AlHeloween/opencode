# Development Plan

## 2026-06-07 Runtime Path And Project DB Routing

Goal: keep runtime data out of copied executable `bin` folders, route project data to the requested project directory when it has local opencode state, and remove the experimental console-account SQLite side database.

Tasks:

- [x] Remove stale automatic cache-collapse and stream-stall control-flow work from the active plan surface.
- [x] Default pre-worktree `Global.Path.data/cache/state/log/bin` to the launch working directory instead of `process.execPath`'s directory.
- [x] Preserve executable-adjacent `Global.Path.config` for the current auth/config policy.
- [x] Treat directories with a local opencode project DB/config file as project boundaries before walking up to a parent git repository.
- [x] Treat `dir\\bin\\opencode.json` and `dir\\bin\\opencode.jsonc` as a boundary for portable bundles launched from `dir`.
- [x] Use stable path-derived project IDs for non-git/no-commit fallback projects instead of routing project data through `ProjectID.global`.
- [x] Preserve normal git-root discovery for subdirectories without local opencode boundaries.
- [x] Remove `account.db` creation by deleting config-level SQLite DB helpers.
- [x] Replace `AccountRepo` SQLite persistence with process-local in-memory state for experimental console account flows.
- [x] Remove unused opencode account/account_state SQLite schema definitions.
- [x] Fix `_build.ps1` PowerShell 5 path joins so the portable bundle build completes.

Verification:

- [x] `bun test --timeout 30000 test/project/project.test.ts` from `packages/opencode` (`cmd_runner` run `20260607T172739Z_0b43b725`).
- [x] `bun test --timeout 30000 test/global.test.ts` from `packages/core` (`cmd_runner` run `20260607T095003Z_a1f469e3`).
- [x] `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts` from `packages/opencode` (`cmd_runner` run `20260607T143800Z_18177818`).
- [x] `bun test --timeout 30000 test/server/httpapi-experimental.test.ts` from `packages/opencode` (`cmd_runner` run `20260607T143800Z_6e017afb`).
- [x] `bun typecheck` from `packages/opencode` (`cmd_runner` run `20260607T143800Z_421139e7`).
- [x] `bun typecheck` from `packages/opencode` after the portable boundary fix (`cmd_runner` run `20260607T172739Z_642b7319`).
- [x] `pwsh _build.ps1` from repo root passed and produced version `10.0.98` (`cmd_runner` run `20260607T172921Z_c0f5d996`).
- [x] Fresh portable launch from `bin_tst\\tst3` opened `bin_tst\\tst3\\.opencode\\data\\opencode.db` and created no `bin\\account.db` (`cmd_runner` run `20260607T173159Z_24d85141`).
- [x] Restore-oriented relaunch reused project ID `c0e7496c66ae89d0c28c5d036a623b3f356c7761` and the same project DB (`cmd_runner` run `20260607T173918Z_cb0a119e`).

## 2026-06-08 Portable Continue Command

Goal: make the TUI exit banner print a restore command that works from a portable bundle directory.

Tasks:

- [x] Replace the hardcoded `opencode -s <session>` banner command with a command derived from the launched executable.
- [x] Prefer a relative executable path when the binary is inside the current working directory.
- [x] Quote executable paths that contain shell-sensitive characters.

Verification:

- [x] `bun typecheck` from `packages/opencode` passed (`cmd_runner` run `20260608T015744Z_ffa4700e`).
- [x] `_build.ps1` passed and produced version `10.0.100` (`cmd_runner` run `20260608T015813Z_c736b7a2`).
- [x] `bin\\opencode.exe -s ses_15b15261fffe3zPa4pCOPoSrpM` from `bin_tst\\tst3` restored the session through `cmd.exe` (`cmd_runner` run `20260608T020231Z_7a7f6fde`).
- [x] Exit banner now prints `Continue bin\\opencode.exe -s ses_15b15261fffe3zPa4pCOPoSrpM` (`cmd_runner` run `20260608T020231Z_7a7f6fde`).

## 2026-06-08 Document Read Conversion

Goal: make the read tool convert local PDF/DOCX/PPTX artifacts through the bundled `opencode-markdownify` executable instead of returning empty content.

Tasks:

- [x] Resolve `opencode-markdownify` from the actual executable/config directory and portable project `bin` folders instead of trusting bare `process.argv0`.
- [x] Add `.pdf` to read-tool binary detection so PDFs consistently enter the document conversion path.
- [x] Surface missing/failing markdownify as a document conversion error instead of returning empty `<content>`.
- [x] Keep binary `.txt` files rejected even though `txt` is a supported markdownify extension for non-binary attachments.
- [x] Resolve Windows drive-less absolute paths against the active project drive before read permission/stat checks.

Verification:

- [x] `bun typecheck` from `packages/opencode` passed (`cmd_runner` run `20260608T144234Z_74fcce27`).
- [x] Artifact conversion through `convertDocument()` returned non-empty markdown for the PDF, PPTX, and both DOCX files in `artifacts/`.
- [x] `bun test --timeout 30000 -t "rejects text extension files with null bytes" test/tool/read.test.ts` passed (`cmd_runner` run `20260608T143539Z_205c3467`).
- [x] `bun test --timeout 30000 test/tool/read.test.ts` passed from `packages/opencode` (`cmd_runner` run `20260608T144234Z_5dafabe4`).

## 2026-06-12 Compaction Usage Semantics

Goal: keep max output as a generation cap only, trigger compaction from actual usage/content thresholds, and preserve the latest real turn verbatim after compaction.

Tasks:

- [x] Remove max output from `usable()` usage calculations.
- [x] Use input/context limit minus a fixed safety buffer as the compaction threshold.
- [x] Force `SessionCompaction.select()` to keep the newest real turn in `tail`.
- [x] Update qwen-like `output == context` regression coverage.
- [x] Update latest-turn preservation regression coverage.
- [x] Run targeted compaction tests from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

Verification:

- [x] `bun test --timeout 30000 test/session/compaction.test.ts` from `packages/opencode` passed: 50 tests, 0 failures (`cmd_runner` run `20260612T073305Z_bdaa0dad`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T073424Z_a1f79784`).

## 2026-06-12 Provider Max Output Cap

Goal: prevent pathological model metadata where native output equals or exceeds context from sending an impossible provider request output cap.

Tasks:

- [x] Cap pathological `output >= context` native limits in `ProviderTransform.maxOutputTokens()`.
- [x] Add focused provider transform regression tests.
- [x] Run focused provider transform tests from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

Verification:

- [x] `bun test --timeout 30000 test/provider/transform.test.ts` from `packages/opencode` passed: 148 tests, 0 failures (`cmd_runner` run `20260612T074312Z_c0e85514`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T074327Z_7d464663`).

## 2026-06-12 Qwen Request Cap Verification

Goal: verify the qwen/openai-compatible LLM request path sends a capped `max_tokens` value when native output metadata equals context.

Tasks:

- [x] Add qwen-like request-body regression test in `session/llm.test.ts`.
- [x] Run focused LLM stream test from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

Verification:

- [x] `bun test --timeout 30000 test/session/llm.test.ts -t "caps max_tokens for qwen-like"` from `packages/opencode` passed: 3 tests, 178 filtered, 0 failures (`cmd_runner` run `20260612T075720Z_e5b7a91e`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T075744Z_64d9ca27`).
