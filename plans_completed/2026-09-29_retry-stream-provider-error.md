<!-- intention: a provider stream error (OpenRouter 502 provider_unavailable / 504 idle timeout) dies as UnknownError and is never retried -> it is classified as a retryable APIError so the existing retry policy survives a transient upstream outage -->
# Retry classification for provider stream errors (AI_StreamProviderError)

**Status:** COMPLETE — owner said "Давай" (2026-09-29T04:08Z); oracle ran same day: RED→GREEN focused, neighbours green, typecheck clean. Closing commit names this plan.

## Prior art (measured this session)

- ✓ Bug evidence: OpenRouter upstream `Stealth` answered the `stealth/space-bunny-alpha` stream with an SSE chunk `"provider":"Stealth","choices":[],"error":{"code":502,"message":"Provider returned an empty response","metadata":{"error_type":"provider_unavailable"}}` — `packages/opencode/.opencode/…` is not the path; actual artifact: `.opencode/data/gateway/per-response/2026-09-29T03-59-26-149Z-3ca76490-48bc-450d-be63-fd768c95c979-attempt1.raw.txt` (also a 504 `Upstream idle timeout exceeded` chunk in `per-response/2026-09-29T01-50-08-823Z-3be0212b-…-attempt1.raw.txt`).
- ✓ Class origin: `ai@7.0.106` — `node_modules/.bun/ai@7.0.106+d6123d32214422cb/node_modules/ai/src/error/stream-provider-error.ts:10-67`. `StreamProviderError` carries `code`, `statusCode`, `isRetryable` (5xx default true), `data` = original provider payload; export at `ai/src/error/index.ts:34`, root import already used in `src/session/message-v2.ts:7` (`APICallError`).
- ✓ Failure path confirmed in DB: `opencode.db` message `msg_0eb5141a5001f5om1D7G5asWgZ` stores `error.name = UnknownError`, `statusCode = NULL`, `isRetryable = NULL` — `MessageV2.fromError` fell into `case e instanceof Error` (`src/session/message-v2.ts:1983`).
- ✓ Consequence confirmed in log: `1790602405977_log_system_internal.jsonl:4595` — `WARN bug: failed to parse retryable error message` (SyntaxError on `"Provider returned an empty response"`), so `SessionRetry.retryable` returned undefined (`src/session/retry.ts:87-99`) and the turn ended instead of retrying.
- ✓ Sibling fix already exists as precedent: `test/provider/h1-transport.test.ts:51-87` — the same class of bug (transport throw → UnknownError → never retried) was fixed 2026-09-17; that test asserts `SessionRetry.retryable(MessageV2.fromError(thrown, …))` is truthy.
- ✗ CodeGraph symbol pack returned "no file paths were resolved" for `fromError` / `retryable` in any mode (index: 5706 files, 73832 nodes). Blast radius was instead confirmed by direct caller search: `MessageV2.fromError` callers are `src/session/processor.ts:565`, `src/session/prompt.ts:1843`, `src/tool/task.ts:47`, `src/acp/agent.ts:618,688,733,798,833`; a new `case` is additive.

## Acceptance frame

| Criterion | Surface | Oracle | Falsifier |
|---|---|---|---|
| A `StreamProviderError` (502 provider_unavailable shape from the real log) is classified as a retryable `APIError` with `statusCode` preserved | `MessageV2.fromError` | focused test in `test/session/retry.test.ts` (red before fix) | result stays `UnknownError` or `statusCode` lost |
| `SessionRetry.retryable` returns a message for that error (turn is retried, not killed) | `SessionRetry.retryable` + policy | same test asserts truthy retry message | undefined retry message |
| 504 idle-timeout variant (same class) is retryable too | same | second case in the same test | non-retryable |
| No regression in existing error classification | `fromError` switch | full `bun test test/session/retry.test.ts` + `test/session/message-v2.test.ts` | any new failure |

## Risks and claims

- C1 Inferred (test + log, not yet reproduced at runtime): fix = classify `StreamProviderError` before the `e instanceof Error` fallback. Falsifier: red test does not go green.
- C2 Inferred: additive `case` cannot change existing branches (they precede it in `switch(true)`). Falsifier: any pre-existing test in the focused files goes red.
- R1 low: OpenRouter keeps answering 502 from the same upstream; retries now surface as TUI `retry` status instead of immediate death. This is the intended behaviour of `retry.ts` (API 5xx retry indefinitely) — not changed here.
- R2 out of scope: config-side mitigations (`provider.openrouter.routing.sort:"price"` in `bin/opencode.jsonc`, variant `max`, `max_tokens` budget) are NOT changed by this plan; they need a separate owner decision.

## Smoke Tests

### Baseline before product-source edit

- [x] ✓ TASK-1 (RED proof, run `20260929T041018Z_7237af61`): `error_test_case` added to `test/session/retry.test.ts` with the exact 502/504 shapes. `bun test test/session/retry.test.ts` → exit 1, 28 pass / 2 fail; both new tests failed on `APIError.isInstance(result) → false` — the bug, reproduced.

### Post-change oracles

- [x] ✓ TASK-3 (GREEN, run `20260929T041103Z_7d483933`): exit 0, 30 pass / 0 fail (was 28/2) on the same command.
- [x] ✓ TASK-4: `bun test test/session/message-v2.test.ts` → 43 pass / 0 fail (run `20260929T041123Z_f08f6fea`); `bun test test/provider/h1-transport.test.ts` → 4 pass / 0 fail (run `20260929T041138Z_8502d86f`). No new failures.
- [x] ✓ Typecheck: `bun typecheck` (tsgo --noEmit) → exit 0 (run `20260929T041147Z_5b472961`).

## Work

- [x] ✓ TASK-1 Create failing `error_test_case` in `test/session/retry.test.ts` (red), from the real 502/504 shapes — run `20260929T041018Z_7237af61`.
- [x] ✓ TASK-2 `trial_fix`: add `case StreamProviderError.isInstance(e)` to `MessageV2.fromError` (import from `"ai"`), mapping to `APIError` with `statusCode`, `isRetryable`, `message`, `responseBody`/`metadata` — `src/session/message-v2.ts:1983-2003`.
- [x] ✓ TASK-3 `trial_fix_test`: focused run green — run `20260929T041103Z_7d483933`.
- [x] ✓ TASK-4 `real_fix_test`: neighbour suites green — runs `20260929T041123Z_f08f6fea`, `20260929T041138Z_8502d86f`.
- [ ] TASK-5 Close: move plan to `plans_completed/`, one commit naming this plan.
