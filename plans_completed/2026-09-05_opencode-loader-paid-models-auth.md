# Bug: opencode loader keeps paid models when auth exists — FIXED 2026-09-06

## Goal
- Fix the failing test `opencode loader keeps paid models when auth exists` in `packages/opencode/test/provider/provider.test.ts` (root-cause the paid-models-with-auth resolution, then repair loader or test). **RESOLVED 2026-09-06 — moved to plans_completed/.**

## Constraints & Preferences
- Tests must run from `packages/opencode` with the package script semantics: `bun run test` or `bun test --timeout 30000`. Bare `bun test <file>` uses bun's default 5s timeout and produces FALSE timeout failures on plugin-config tests (verified 2026-09-05 — see Non-goals).
- Avoid mocks where an actual implementation can be tested (project testing rule).
- Every catch must log; plan-to-code gaps are bugs.
- Discovered during the provider-sync runtime-overlay session (2026-09-05); proven pre-existing via `git stash` experiment (clean tree fails identically).

## Progress
### Done
- Attribution experiment (2026-09-05): with session changes 77 pass / 2 fail; on stashed clean tree 72 pass / 5 fail. This bug fails on BOTH trees (assertion, not timeout: ran 4.4–4.5s, under any timeout).
- Ruled out as non-bugs (all pass with `--timeout 30000`): `plugin config enabled and disabled providers are honored`, `plugin config providers persist after instance dispose`, `defaultModel returns first available model when no config set` — their 5000ms failures were default-timeout artifacts of bare `bun test` invocation.
- `provider.sort prioritizes preferred models` test fixed during the provider-sync session (test assumed id asc; contract in `Provider.sort` is id desc — newer versions first). No longer failing.
- 2026-09-06 oracle re-run BEFORE fix [Exact] (`20260906T011933Z_e438c181`): 76 pass / 2 fail — bug still failing (identical assertion), second fail = plugin test hitting the 30s cap (see below). Plan closure attempt denied by oracle; user runtime report («модели отображаются корректно») explained by `51d9ac208e` compiled-binary registry fix — tests run against TS source, different surface.
- **RCA (Exact, 2026-09-06):** `Auth.authFile()` reads `path.join(Global.Path.config, "auth.json")` (`src/auth/index.ts:11-13`); `Global.Path.config` = `dirname(process.execPath)` overridden by `OPENCODE_TEST_CONFIG` (`packages/core/src/global.ts:16,43-45`); test preload isolates config to `.temp/test/opencode-test-data-<pid>/configs` (`test/preload.ts:54-56`). The test wrote auth to `Global.Path.data/auth.json` (worktree `.opencode/data`) — a directory the loader NEVER reads. Hypothesis (a) confirmed. The loader itself is correct (product auth lives at exe-adjacent config; real machine: `bin/auth.json`).
- **Fix 1 (test):** auth fixture now redirects `OPENCODE_TEST_CONFIG` to the keyed tmpdir (canonical pattern from `test/auth/auth.test.ts:18-26`), writes `auth.json` via `Global.Path.config`, restores the env in `finally`. Fixture, `.enc` mirror and `.opencode.encryption.key` are disposed with the tmpdir; real auth untouched. Removed the now-dead `Filesystem`/`unlink` backup dance.
- **Fix 2 (test):** `plugin config enabled and disabled providers are honored` — solo run proved the test deterministic-slow (18.68s with `--timeout 120000`, `20260906T013950Z_d95c36ba`), hitting the 30s cap in full-file runs. Cause: bare tmpdir without package-lock engages the file-plugin dependency-preparation (install) path. Mirrored the sibling dispose test: `markPluginDependenciesReady(configDir)` + `markPluginDependenciesReady(Global.Path.config)`. Duration dropped 18.68s → 3.68s (`20260906T014236Z_2b2346b4`); no network dependency, assertions unchanged.

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Attribution method: `git stash push -u` → run suite on clean tree → `git stash pop` (restored with `OPENCODE_ALLOW_DESTRUCTIVE=1` per constitution, since the stash held the only copy of uncommitted work). Result attributing failures above is Exact.
- Do NOT widen scope to deprecated-model visibility (loader hides `status: "deprecated"` at `provider.ts:1413` — existing product behavior; separate product decision, not this bug).
- Genuine side = TEST SETUP, not the loader: product reads auth from `Global.Path.config` (executable-adjacent — matches real-machine `bin/auth.json` layout). Test was pointing at the wrong Global surface.
- Test-fixture hygiene: `OPENCODE_TEST_CONFIG` redirect (not `OPENCODE_AUTH_CONTENT`) so the real file-read branch of `Auth.all()` is exercised, per "avoid mocks, test actual implementation".

## Next Steps
- [x] RCA: test body + loader auth resolution traced — loader reads `Global.Path.config/auth.json`; test wrote `Global.Path.data/auth.json` (never read).
- [x] Hypotheses verified: (a) path mismatch — CONFIRMED; (b)/(c) not needed.
- [x] Fix the genuine side (test setup), both assertions kept (`none` = 0 stays).
- [x] Regression: full `test/provider/provider.test.ts` → 78 pass / 0 fail; `bun run typecheck` exit 0.
- [x] Move plan to `plans_completed/`, scan active plans for stale references.

## Critical Context
- Root-cause chain (all Exact, 2026-09-06): `auth/index.ts:11-13` (`Global.Path.config`) → `core/global.ts:16,43-45` (exeDir + `OPENCODE_TEST_CONFIG` override) → `test/preload.ts:54-56` (isolated testConfigDir) → old test wrote `Global.Path.data` (`global.ts:31-33`, worktree-scoped, mutated by `initFromWorktree`).
- Companion assertions kept: `opencode loader keeps paid models when config apiKey is present` (passing sibling).
- Bun version: 1.4.0-canary.1 (Windows x64). OS win32. Tests via `cmd_runner` (low priority), solo runs — parallel typecheck+test caused a contention-flake on 2026-09-06 (recorded, not reproduced solo).

## Relevant Files
- `packages/opencode/test/provider/provider.test.ts` — both fixes live here (auth fixture redirect ~:2668; plugin deps ~:2586)
- `packages/opencode/src/auth/index.ts` — `authFile()` = `Global.Path.config/auth.json` (product truth, unchanged)
- `packages/core/src/global.ts` — path semantics: config=exeDir(+`OPENCODE_TEST_CONFIG`), data=worktree-scoped
- `packages/opencode/test/preload.ts` — test config isolation (`testConfigDir`)
- `packages/opencode/test/auth/auth.test.ts` — canonical OPENCODE_TEST_CONFIG save/set/restore pattern

## Smoke Tests
### Baseline (pre-fix) [Exact]
| # | Command (cwd) | Expected then | Actual |
|---|---------------|--------------|--------|
| 1 | `cmd_runner start --cwd packages/opencode -- bun test --timeout 30000 test/provider/provider.test.ts` | known fail (bug) | FAIL `20260906T011933Z_e438c181`: 76 pass / 2 fail — `keyedCount` 0 at `:2723` (2266ms, assertion) |

### Post-fix oracles [Exact]
| # | Command (cwd) | Pass criteria | Actual |
|---|---------------|--------------|--------|
| 1 | `... bun test --timeout 30000 test/provider/provider.test.ts -t "opencode loader keeps paid models"` | 2 pass / 0 fail | PASS `20260906T013403Z_3ac84b66` (8.20s) |
| 2 | `... bun test --timeout 30000 test/provider/provider.test.ts` | 78 pass / 0 fail | PASS `20260906T014259Z_e2e22e62` (176.88s) |
| 3 | `... bun run typecheck` | exit 0 | PASS `20260906T014652Z_e91dd478` |
| 4 | plugin test solo `-t "plugin config enabled..."` | fast pass under 30s cap | PASS `20260906T014236Z_2b2346b4` (3.68s; was 18.68s `20260906T013950Z_d95c36ba`) |
