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

## 2026-06-12 Ordered Compaction Replacement

Goal: make compaction preserve normal message order by summarizing the active history before the latest real turn, then using the summary immediately before that latest turn.

Tasks:

- [x] Stop removing and re-appending prior compaction pairs during compaction prompt construction.
- [x] Preserve only the newest real turn as the post-summary tail for regular compaction.
- [x] Preserve no extra tail during overflow replay, because the replayed user request is inserted after the summary.
- [x] Update compaction regression tests for ordered replacement semantics.
- [x] Run targeted compaction tests from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

Verification:

- [x] `bun test --timeout 30000 test/session/compaction.test.ts` from `packages/opencode` passed: 50 tests, 0 failures (`cmd_runner` run `20260612T094919Z_3921508d`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T095402Z_abf22fa9`).

## 2026-06-13 Compaction Skill Prompt Isolation

Goal: keep the normal system prompt immutable during compaction while moving compaction formatting rules into a deterministic skill payload.

Tasks:

- [x] Pass the normal system prompt from `prompt.ts` into `SessionCompaction.process`.
- [x] Remove the compaction summary template from the final compaction user instruction.
- [x] Inject the compaction template as a deterministic `<skill_content name="compaction">` message before the dynamic summary instruction.
- [x] Preserve plugin `context` and `prompt` behavior for the dynamic compaction instruction only.
- [x] Add regression coverage for normal system propagation and skill-payload isolation from `input.system`.
- [x] Run targeted compaction tests from `packages/opencode`.
- [x] Run revert-compaction tests from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

Verification:

- [x] `bun test --timeout 30000 test/session/compaction.test.ts` from `packages/opencode` passed: 51 tests, 0 failures (`cmd_runner` run `20260613T022803Z_32d575c5`).
- [x] `bun test --timeout 30000 test/session/revert-compact.test.ts` from `packages/opencode` passed: 7 tests, 0 failures (`cmd_runner` run `20260613T022803Z_c99ceaf9`).
- [x] `bun test --timeout 30000 test/session/compaction.test.ts -t "passes normal system"` from `packages/opencode` passed: 1 test, 156 filtered, 0 failures (`cmd_runner` run `20260613T023216Z_a23632a8`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260613T022803Z_7ca3d452`).

## 2026-06-13 Compaction Normal-Flow Integration

Goal: make compaction flow through the normal message pipeline instead of a separate processing path, preserving system prompt identity for KV cache continuity.

### Architecture change

Before: compaction used `compaction.process()` — a separate processor call with hardcoded skill injection, a tool-less "compaction" agent, and empty system prompt. This broke semantic flow and invalidated the provider's KV cache (different system prompt hash).

After: compaction is just another turn in the conversation. `compaction.create()` inserts a user message with a text instruction ("Please create a structured summary..."). The normal processor loop picks it up, uses the **same agent** as the original turn, constructs the **identical system prompt**, and processes it through `handle.process()`. The summary assistant response gets `summary: true` for boundary detection.

### KV cache continuity

The system prompt is byte-stable across the full session:
- `sys.skills(agent)` — same agent → same skills content
- `sys.environment(model)` — no timestamps, no mutable markers
- `instruction.system()` / `instruction.rules()` — file-based, session-stable
- Date injection goes into **user messages**, not system prompt
- `format` / `json_schema` check matches normal turn behavior

Providers see identical SHA256(system prompt) across compaction and normal turns → prefix cache hits → minimum recomputation.

### Tasks

- [x] Create `src/skill/compaction/SKILL.md` — compaction as a proper skill file with YAML frontmatter.
- [x] Register "compaction" as a built-in skill in `skill/index.ts` (available to all agents).
- [x] Remove hardcoded `COMPACTION_SKILL_CONTENT` from `compaction.ts` — skill content flows through `sys.skills()`.
- [x] Remove `compaction.process()` function and its service interface entry.
- [x] Rewrite prompt.ts compaction task block to use normal processor: same agent, same system prompt, same `handle.process()`.
- [x] `compaction.create()` now uses `input.agent` (original user agent) instead of hardcoded `"compaction"`.
- [x] Add `summary: true` to compaction assistant message for `filterCompactedEffect` boundary detection.
- [x] Call `compaction.selectMessages()` to set `tail_count` on the compaction part.
- [x] Add `bypassAgentCheck: false` to `SessionTools.resolve()`.
- [x] Add `format` / `json_schema` check for system prompt parity with normal turns.
- [x] Remove 21 `session.compaction.process` tests (no longer applicable).
- [x] Update `create` test to expect text part + compaction part.
- [x] Run typecheck and all compaction tests.

### Verification

- [x] `bun typecheck` from `packages/opencode` passed.
- [x] `bun test test/session/compaction.test.ts` from `packages/opencode`: 31 pass, 0 fail.
- [x] `bun test test/skill/skill.test.ts` from `packages/opencode`: 10 pass, 0 fail.

## 2026-06-17 Remove Autoupdate & Telemetry

Goal: Strip all autoupdate infrastructure (CLI, Tauri, Electron, web app, config, flags, server, OpenAPI, SDK, i18n, docs) and remove PostHog/OpenTelemetry collection.

Tasks:
- [x] Remove CLI upgrade files + commands
- [x] Clean Installation module (remove upgrade/latest/events)
- [x] Remove Tauri desktop updater + deps
- [x] Remove Electron desktop updater + deps
- [x] Remove web app update UI (layout, settings, platform, error)
- [x] Remove i18n updater strings (49 files, 3 packages)
- [x] Remove PostHog from stats script
- [x] Strip OpenTelemetry from observability, LLM, agent, config, deps
- [x] Clean OpenAPI schema + regenerate SDK
- [x] Clean documentation across 19 locales (config, cli, troubleshooting, plugins)
- [x] Fix 10 config test failures (OPENCODE_TEST_CONFIG env var)
- [x] Fix test isolation (Duration.infinity caching removed)

Verification:
- [x] `bun typecheck` from `packages/opencode` — PASS
- [x] `bun test test/config/config.test.ts` — 75 pass, 0 fail
- [x] `bun test test/auth/auth.test.ts` — 4 pass, 0 fail
- [x] SDK regenerates clean

## 2026-06-18 Reasonix-Inspired Enhancements

Goal: Adopt multi-tier compaction, background job manager, tool descriptions rewrite, directory navigation from DeepSeek-Reasonix analysis.

Tasks:
- [x] Multi-tier compaction (soft/full/force thresholds, stuck detection, improved summary template)
- [x] CompactionNotice TUI toast
- [x] Background job manager (Jobs.Service with startEffect, output, kill, drain)
- [x] bash tool run_in_background flag
- [x] job_output + job_wait tools
- [x] Completion notes injected into next turn prompt
- [x] Jobs SQLite persistence via separate jobs.db (orphan recovery on startup)
- [x] Task tool background integration (run_in_background flag)
- [x] Tool descriptions rewrite (17 of 20 files)
- [x] Directory navigation settings (navigation.allow/deny, TUI dialog)

Verification:
- [x] `bun typecheck` from `packages/opencode` — PASS
- [x] `bun test test/jobs/jobs.test.ts` — 4 pass, 0 fail
- [x] `bun test test/cli/tui/effective-navigation.test.ts` — 11 pass, 0 fail
- [x] `bun test test/config/config.test.ts` — 75 pass, 0 fail
