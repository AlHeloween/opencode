# Bug: opencode loader keeps paid models when auth exists

## Goal
- Fix the failing test `opencode loader keeps paid models when auth exists` in `packages/opencode/test/provider/provider.test.ts` (root-cause the paid-models-with-auth resolution, then repair loader or test).

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
- Observed log marker at failure time: `provider test: auth file read skipped (not found)`.

### In Progress
- (none — plan written for a separate session)

### Blocked
- (none)

## Key Decisions
- Attribution method: `git stash push -u` → run suite on clean tree → `git stash pop` (restored with `OPENCODE_ALLOW_DESTRUCTIVE=1` per constitution, since the stash held the only copy of uncommitted work). Result attributing failures above is Exact.
- Do NOT widen scope to deprecated-model visibility (loader hides `status: "deprecated"` at `provider.ts:1413` — existing product behavior; separate product decision, not this bug).

## Next Steps
- [ ] RCA: read the failing test body (`test/provider/provider.test.ts` ~lines 2650–2710): it creates two tmpdirs (no-key / keyed), writes an auth entry for provider `opencode` in the keyed one, calls the opencode custom loader + `list()`, and expects paid models only when auth exists. Current result: `keyedCount` = 0, expected > 0 (`expect(none).toBe(0)` passes — no-leak side is fine).
- [ ] Trace the `opencode` custom loader + auth resolution in tests (`modelLoaders` in `src/provider/provider.ts` init; auth file location the loader reads vs the location the test writes — `Global.Path.config`/`auth.json` vs tmpdir). Hypotheses (unverified): (a) loader reads auth from a path the tmpdir test does not configure; (b) paid-model filter drops everything before auth is consulted; (c) test fixture writes auth in a format the loader's reader rejects. Verify against actual code before changing anything.
- [ ] Fix the genuine side (loader auth path or test setup), keep both assertions (`none` = 0 stays).
- [ ] Regression: full `bun run test` from `packages/opencode` green; then `bun run typecheck`.
- [ ] After done: move this plan to `plans_completed/`, scan active plans for stale references.

## Critical Context
- Failure signature (2026-09-05, both trees):
  `expect(received).toBeGreaterThan(expected)` — Expected > 0, Received 0 at `test/provider/provider.test.ts:2707-2709` (line drifts ±2 between runs; locate by test name).
- Correct repro (assertion failure, not timeout):
  `cd packages/opencode && bun test --timeout 30000 test/provider/provider.test.ts -t "opencode loader keeps paid models"`
- Companion assertions in the same test file that PASS and must keep passing: `opencode loader keeps paid models when config apiKey is present` (~2600s).
- Related session surfaces (context, not part of this bug): `src/provider/provider-sync.ts` (live registry overrides), `src/provider/models.ts` `Data()` bundled-overlay, `Model.options`/`parameters`/`model_type` schema additions in `src/provider/provider.ts` + `src/provider/models.ts`.
- Bun version: 1.4.0-canary.1 (Windows x64). OS win32.

## Relevant Files
- `packages/opencode/test/provider/provider.test.ts`: failing test (~2650–2710) + passing sibling (~2600s)
- `packages/opencode/src/provider/provider.ts`: Provider init (`modelLoaders`, custom loader registration), auth merge (`source: "api"`), `Model` schema
- `packages/opencode/src/provider/models.ts`: `Data()` registry source (fixture/cache/overlay branches)
- `bin/auth.json`: real-machine auth shape reference (`opencode.type = api`, key present) — do not commit, do not print keys

## Smoke Tests
- Baseline (pre-fix, current state): `cd packages/opencode && bun test --timeout 30000 test/provider/provider.test.ts -t "opencode loader keeps paid models"` → FAIL (`keyedCount` 0, expected > 0).
- Post-fix oracle: same command → PASS (both assertions: `none` = 0 AND `keyedCount` > 0).
- Regression gate: `cd packages/opencode && bun run test` (full suite, `--timeout 30000`) → 0 fail; `bun run typecheck` → exit 0.
