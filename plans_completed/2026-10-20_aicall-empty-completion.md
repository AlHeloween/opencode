<!-- intention: an empty completion is indistinguishable from a refusal -> aicall names the empty completion as a failure with its remedy, and never overwrites a target with nothing -->
# t103 — aicall: an empty completion is a named failure, not silence

```yaml
Keywords: aicall-empty-completion 0.35, truncated-reasoning-budget 0.25, tool-reports-its-own-failure 0.20, output-file-not-clobbered 0.12, guard-before-commit 0.08
Semantic dominant: The isolated call now names an empty completion as a failure with the max_tokens remedy, and no longer overwrites the target file with nothing.
md5: 2f8a6c05d4e19b73a60c8f512d3e7b49
prev-md5: 5a71c9e40b3d8f2169ce7a54b2d8f30
parent-goal-md5: 8f4a2d60c1e93b57e0d2a9c14b6f37e1
note: hash values are generative tags — search them, never compute them.
```

## Status

- [x] Measured the failure: the same prompt returned NO text at `max_tokens` 1500 and 6000 and the full answer at 20000; a 26-char control answered at 50 (aicall, openrouter `minimax/minimax-m3.1-flash:free`, free tier, temperature 0). The request SUCCEEDS — a reasoning model spends the budget on reasoning tokens and the answer never reaches the text — so the tool printed its envelope and nothing else, which reads exactly like a refusal and gets written down as «the model declined»
- [x] Implement: `isEmptyCompletion` + `emptyCompletionReport` exported from `packages/opencode/src/tool/aicall.ts`; the call returns `FAILED (empty completion)` with the `max_tokens` remedy instead of an envelope and silence
- [x] No clobber: the guard sits BEFORE the `output_file` branch, so a target is never overwritten with an empty file
- [x] The lesson reaches the caller before the call: `aicall.txt` names an empty result a truncated budget, not a refusal
- [x] Oracle: `bun test test/tool/aicall.test.ts` → 6 pass / 0 fail (run 20261020T023441Z_b16f2b8a, exit 0) with 2 new tests; `bun typecheck` → exit 0 (run 20261020T023441Z_ee21629d); _build.ps1 run 20261020T023548Z_6ab93621 exit 0, bytes_written 66031, smoke 10.0.1471
- [x] The guard earned its place BEFORE the commit: the first patch put the helpers inside `isRouterModel` and the new test failed at once («Unexpected export»)

## Smoke Tests

- `bun test test/tool/aicall.test.ts` — 6 pass, 0 fail; the empty-completion report names the failure, carries the envelope, and names the `max_tokens` remedy
- `bun typecheck` (from `packages/opencode`) — exit 0
- `_build.ps1` — exit 0, bytes_written 66031, smoke 10.0.1471

## Residual

- The tool REPORTS the empty completion; it cannot recover the answer the budget ate. Raising `max_tokens` is the caller's move, and the message says so.
- The kernel's G2 rule still names a canon harness path that does not exist (`experiments/2026-10-13_experiments-canon/` — the real one is `2026-09-13_`). That is a kernel line, and the kernel is changed by a build, never by hand — recorded in memory, not patched here.
