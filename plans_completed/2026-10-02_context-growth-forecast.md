# Forecast of model requests before compact, from context growth

<!-- intention: the agent is frightened by a wrong window remainder -> a calm estimate of the number of model requests before compact from the previous new spend, excluding the constant prefix and repeated tools -->

Status: COMPLETE (2026-10-02). Ground for MODIFY_PROJECT: the owner demanded the calculation be fixed, proposed
least squares on an exponential, and excluded prefix changes. `bin/` is out of scope. Implemented by a GPT (Codex)
session; reviewed, worded, translated, verified and committed by Claude.

```yaml
Keywords: forecast 0.45, context-growth 0.30, prefix-stability 0.15, compaction 0.10
Semantic dominant: Forecast model requests before compact from individual requests under an unchanged prefix.
md5: 2c4f07b6e9814ab3a59d6208fd174e3c
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Grounds and acceptance

- ✓ Codegraph and processor.ts: message tokens SUM the steps; the series is taken from `step-finish.tokens`. Full
  prompt = input + cache.read + cache.write. The constant part cancels in the difference.
- ✓ The old `burnRate` divided the whole window by the user messages. In the live XEComponents session all ten
  model requests belonged to ONE user root: they are different units.
- ✓ Live growth values 9558, 14099, 28515, 12328, 8842, 26404, 12965, 11709, 488 are not a smooth exponential. The
  model is a hypothesis; its fitness is checked on the held-out last observation.
- ✓ Baseline `20261002T140205Z_b5bfc5f7` (GPT session): tail-note/checkstate 18/0, dropped=0, truncated=false.
- Predicates: constant prefix/cache partitions do not change the forecast; multi-step requests are counted
  separately; a change of wire prefix/model and a compact start a new series; least squares recovers a known
  decaying exponential on an independent continuation; a noisy series gets an explicitly marked recent-steps
  estimate; unknown never means zero.
- Format: an approximate number of **model requests before compact**; a compact lets the work continue.
  Push / checkstate / metadata use one forecast. The actual window fill still counts cached tokens.

## Bindings / smoke / envelope

- [x] F1: pure forecast in `session/context-forecast.ts`, test `test/session/context-forecast.test.ts`. Least squares
  `c + a*q^i`, `a, c >= 0`, `0 <= q <= 1`; too few or noisy samples → a marked estimate, never an invented zero
  remainder. Numeric contract: at least 4 growth samples, at most 64; fit the first n-1, held-out error <= 35 % of
  the mean of all n and training RMSE <= 35 % of the training mean, else the mean of the last four. The known
  exponential is checked against the subsequent independent cumulative spend. Horizon 1024 gives a lower bound,
  not infinity. ✓ Claude's run `20261002T145809Z_dfff20ca`: 7 files 177/0. RED-before the old formula was not
  re-run by Claude — the new file imports symbols that did not exist before, so it cannot run on the old source.
- [x] F2: LLM final system + wire tools fingerprint → callback → optional `step-finish.contextPrefix`. The prefix is
  NOT changed; only a measurement is added to an existing part. Old records without a fingerprint do not confirm
  stability: unknown, never mixed into a new series. Paths: session/llm.ts, processor.ts, message-v2.ts, SDK
  `src/gen/types.gen.ts` and `src/v2/gen/types.gen.ts`. Reuses the full `[name, description, schema]` wire-catalog
  hash (not names only) and `hashInfo(system)` with array boundaries. Oracle: a change of schema / description /
  order / system boundaries changes the stamp; unchanged wire content keeps it; the new part is read back from real
  Session storage. ✓ Read by Claude in the diff: the callback only measures — the wire payload is unchanged (no
  KV-cache impact); the fingerprint test and the storage read-back are in `context-forecast.test.ts`.
- [x] F3: WindowState / tailNote / checkstate use the F1 result; the last provider usage is read from step-finish,
  the message total only for legacy records. Historical status parts are not rewritten; the push stays the snapshot
  of the user message's first step, checkstate the current state. ✓ Same run; Claude also confirmed the SPACE rule
  (AGENTS): growth, fill (`windowFillTokens`, request space) and threshold (`usable()`, request budget) share one
  space — the old checkstate label «tokens of visible content» was wrong and is now «request tokens».
- [x] F4: focused baseline / RED / GREEN, typecheck, documentation / index / log, plan review, named commit.
  Claude's review changes: the agent-facing text says «model requests», not «agent turns» (the series counts steps;
  one user turn holds many — the same steps-vs-turns confusion produced a false «0/79» alarm that day); the plan and
  the docs/compaction.md section translated to English (artifact language). Final run after the wording change:
  7 files 177/0 (`20261002T150147Z_23b1f137`), typecheck exit 0 (`20261002T150147Z_8bbf6fab`); sdk/js typecheck
  exit 0 (`20261002T145809Z_e8ba0ee5`).

Scope: the listed session files, tool/checkstate, their focused tests, docs/compaction.md, docs/README.md, this
plan and _progress_log.md. Classes READ / PLAN_WRITE / MODIFY_PROJECT. Rollback: reverse the scoped patch. No
kernel/prefix edits, promotion, services or external messages.

Oracle: independent numeric continuations, real persisted step-finish read-back, the existing token-accounting /
cadence / caching tests, package typecheck. A forecast of future load stays an estimate; PASS covers the algorithm
and the contract.

## Risks and residual

- A cache hit/miss alone does not prove a prefix change. The exact wire-prefix measurement is required; a large
  tool result must not be dropped just for its size.
- The forecast is bounded by a horizon of 1024 requests (above it a lower bound is shown), so an exponential with a
  zero limit cannot promise endless work.
- A rising cost per step cannot be expressed by the decaying model; the fallback mean of the last four is then
  optimistic. Marked «estimate»; not a blocker.
- Fresh prefix statistics appear in the live binary only after the owner promotes a build; old data has no stamp.
- The original visual residual and the live application of the pause fix stay in
  plans/2026-10-02_render-artifacts-and-post-tool-pause.md.
