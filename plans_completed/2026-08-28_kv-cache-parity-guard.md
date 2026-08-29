# KV-Cache Parity Guard + Timeline Analyzer

Created: 2026-08-28T00:20Z
Author: build_mode
Status: COMPLETED 2026-08-28T00:35Z — all tasks [x], all oracles PASS

## Goal

Restore automated detection of cache-poisoning content mutations (the role the
removed 639-line speculative fingerprint audit played) at O(1) per-message cost,
and ground the regression analysis in a reusable log-timeline analyzer under
`experiments/kv-cache-parity/`.

## Background (claim ledger)

| id | claim | status | provenance | evidence |
|----|-------|--------|------------|----------|
| C1 | Full cold miss after process restart: 176137 input, 0 cached @23:44:22 | Exact | RETRIEVED | .opencode/data/log/1787874235551_*.jsonl:10 |
| C2 | Mid-session system mutation 95038→150706 chars, systemMsgCount 8→9 @23:47:40 | Exact | RETRIEVED | same file:67 (WARN bug: system prompt content changed mid-session) |
| C3 | New session first request hit 41024 cached (ratio 0.805), NOT zero-hit | Exact | RETRIEVED | 1787874864732_*.jsonl:10 |
| C4 | hasCacheControl:false, cacheControlValue:null on every openrouter request | Exact | RETRIEVED | both jsonl logs, "cache marker check" events |
| C5 | Speculative fingerprint audit removed in 352e073279 (cache-control.ts, 639 lines) | Exact | RETRIEVED | git show 352e073279 --stat |
| C6 | messages hashed only as aggregate in debug payload; never compared turn-over-turn | Exact | RETRIEVED | llm.ts:687 (hashInfo(messages), no comparison) |
| C7 | Clean-turn uncached 368–751 vs user-reported baseline 56–100 | Inferred | CONTEXT | log rows vs user report; needs E4 baseline to confirm |

## Tasks

### T1 — Timeline analyzer (experiments lane)

- what: `experiments/kv-cache-parity/2026-08-28_analyze_cache_timeline.py`
  - parse `*_log_*.jsonl` events: cache hit/miss, cache marker check, system
    prompt content changed, prefix reset, system prompt ready (once)
  - parse `*_diff_*.diff` turn pairs: added/removed/changed, reasoning bytes,
    tool-result bytes
  - markdown timeline per session + anchor verification mode `--require-anchors`
- files: `experiments/kv-cache-parity/2026-08-28_analyze_cache_timeline.py`, `experiments/kv-cache-parity/README.md`
- oracle: script exit 0 on real logs; report contains C1, C2, C3 anchors (ts + token numbers)
- depends_on_claims: C1, C2, C3 (anchors used as oracle fixture)
- status: [x] — oracle PASS: --require-anchors FOUND×3 (92 rows, 75 diffs)

### T2 — messages wire-drift guard (llm.ts)

- what: per-position hash ledger of the wire messages array per providerCacheKey.
  - pure verdict fn `messagesStabilityVerdict(prev, next)` (exported, unit-tested):
    first | stable | mutated{position,mutatedTail} | restructured{firstDivergence}
  - `checkMessagesStability(...)` logs `bug: sent message content mutated
    mid-session` (warn) or `messages prefix restructured` (info, compact/restart)
  - `resetMessagesStability()` export for test isolation
  - wire into `run()` next to `checkToolStability`
- files: `packages/opencode/src/session/llm.ts`, `packages/opencode/test/session/llm.test.ts`
- oracle: `bun test test/session/llm.test.ts` PASS (new describe block) + `bun typecheck` PASS
- depends_on_claims: C6
- status: [x] — oracle PASS: bun test llm.test.ts 26/26 (20260828T003148Z_12c6e1ea); typecheck exit 0 (20260828T002821Z_ba35c692)

### T3 — Live replay procedures (E2/E3/E4)

- what: README procedures for cold-matrix (within-TTL / paused / restart),
  nested-AGENTS touch, clean-turn baseline; analyzer `--session`/`--since`
  filters to extract each matrix row. No invented server endpoints — scenarios
  run through the normal TUI/server usage, analyzer reads logs.
- files: `experiments/kv-cache-parity/README.md`
- oracle: analyzer filters run exit 0 on post-scenario logs (documented manual run)
- depends_on_claims: C3, C4
- status: [x] — README procedures + E4 baseline recorded (clean turns 108–209 uncached)

### T4 — Progress log

- what: append entry to `_progress_log.md` (reason, artifacts, output anchors)
- files: `_progress_log.md`
- oracle: file updated, entry timestamped
- depends_on_claims: (none)
- status: [x] — _progress_log.md entry appended

## Smoke Tests

smoke_na: false

baseline:
- label: typecheck-pre
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun run typecheck"
  expected_exit: 0
  note: run via cmd_runner start -- (crash-prone binary)
- label: llm-tests-pre
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun test test/session/llm.test.ts"
  expected_exit: 0
  note: run via cmd_runner start --

post_checks:
- label: typecheck-post
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun run typecheck"
  expected_exit: 0
- label: llm-tests-post
  cmd: pwsh -NoProfile -c "cd packages/opencode; bun test test/session/llm.test.ts"
  expected_exit: 0
- label: analyzer-anchors
  cmd: python experiments/kv-cache-parity/2026-08-28_analyze_cache_timeline.py --require-anchors
  expected_exit: 0

blast_radius: llm.ts (additive module-level guards, one call site), llm.test.ts
(additive describe), new experiments/kv-cache-parity/* files, _progress_log.md.
No behavior change on request path beyond two Map ops + hash per message.

## Outcome Contract

acceptance_criteria:
- id: AC1 — guard detects mid-history mutation: unit test mutated→warn verdict
  oracle_cmd: bun test test/session/llm.test.ts (new block)
  expected_result: PASS
- id: AC2 — analyzer reproduces C1/C2/C3 anchors from existing logs
  oracle_cmd: python experiments/kv-cache-parity/2026-08-28_analyze_cache_timeline.py --require-anchors
  expected_result: PASS
- id: AC3 — typecheck clean
  oracle_cmd: bun run typecheck (packages/opencode)
  expected_result: PASS
coverage_threshold: 1.0
critical_risks: []
