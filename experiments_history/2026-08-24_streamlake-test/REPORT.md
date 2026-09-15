# StreamLake / KAT — verification series report

**Date:** 2026-08-14 · **Script:** `experiments/2026-08-24_streamlake-test/pasha_test.py` (modified from `bin/pasha_test.py`)
**Model:** `ep-kneqk9-1786632248553436783` via `https://vanchin.streamlake.ai/api/gateway/coding/v1`
**Key:** `bin/auth.json` → `pasha-coder.key` (never logged)

## Runs

| Series | Raw results | Notes |
|---|---|---|
| ladder (8 turns, ~132-token prompt) | `results/20260814T143132Z_verify_series.json` | doc replication |
| big-default (6 turns, 72 076-token prefix) | `results/20260814T143454Z_verify_series.json` | multiturn + thinking |
| big-nothink (`enable_thinking:false`) | same file | C4 check |
| big-preserve (`preserve_thinking:true`) | same file | C4 check |

## Claim-by-claim verdict vs `docs/streamlake-kat-thinking-cache.md`

| # | Doc claim | Verdict | Evidence |
|---|---|---|---|
| C1 | Cache accounting is 128-token steps | **CONFIRMED with nuance** | Hits land on a 64-token lattice: 65 536 (64 Ki), 72 064, 72 128; deltas 64/128 (matches doc's own 128→192 ladder). 65 536 = exact 64-Ki grid point from the doc. |
| C2 | `cached_tokens: null` is not a miss | **CONFIRMED (accounting) + latency nuance** | Null ≠ 0 (never saw explicit 0 on the big prefix). Ladder: null 850 ms vs hit 784 ms — identical. Big prefix: null turns 3-4× slower (6 482 vs 1 642 ms median) — null looks like cold-routing re-prefill, not accounting miss. |
| C3 | Echo of `reasoning_content` does not inflate `prompt_tokens` | **CONFIRMED at scale** | Prompt grows +26.8–27.4 tokens/turn with echo 53–6 423 chars/turn; growth = question+answer text only. |
| C4 | `chat_template_kwargs` not forwarded by this gateway | **CONFIRMED both directions** | `enable_thinking:false` still produced 26–1 712 reasoning tokens/turn; `preserve_thinking:true` did not change prompt growth (no 17/33/49/65-Ki shift). |
| C5 | `prompt_cache_key` isolates buckets | **CONFIRMED** | Each series used its own bucket key; turn 1 of every big series started `cached: null` (cold) although the same 72K prefix was warmed minutes earlier in another bucket. |

## Hit / miss ratios (the requested metric)

| Series | avg hit ratio | max | miss tail per turn |
|---|---|---|---|
| ladder (tiny prompt) | 0.6876 | 0.835 | noisy — prefix too small vs overhead |
| big-default | **0.9993** | 0.9993 | 47–183 tokens of 72K |
| big-nothink | 0.9691 | 0.9996 | 47–6 598 tokens |
| big-preserve | 0.9687 | 0.9988 | 47–6 598 tokens |

On the large stable prefix the gateway caches essentially the entire system+pad block: miss = only the newly appended turn text. Ratio ≈ 1.0.

## New finding (root cause of the earlier "9×100% miss" mystery)

The gateway **only reports `usage` when the client requests it** via
`stream_options: {"include_usage": true}`. Without it every chunk carries
`usage: null` — exactly what T1 saw in opencode's wire logs.

opencode's openai-compatible SDK path already sets `includeUsage` (provider.ts:1425),
but the **copilot SDK route** (`copilot-provider.ts`) did not → all pasha-coder
traffic went out without `stream_options` → zero cache metrics.

**Fixed:** `packages/opencode/src/provider/sdk/copilot/copilot-provider.ts` now passes
`includeUsage: options.includeUsage !== false`. `bun typecheck` PASS (cmd_runner run
`20260814T143736Z_65596181`). After rebuild, cache read/write metrics for this
provider become visible in opencode's DB/logs.

## Smit implication (unchanged from doc)

Production stays on default interleaved thinking (no `preserve_thinking` default) —
confirmed again today: the gateway does not forward `chat_template_kwargs`.
