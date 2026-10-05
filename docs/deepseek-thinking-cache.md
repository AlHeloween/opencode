# DeepSeek: thinking vs prompt cache

**Status:** measured 2026-08-14 on `deepseek-v4-pro` via `https://api.deepseek.com`
**Script:** `experiments/2026-08-14_deepseek-test/deepseek_test.py` (key from `DEEPSEEK_API_KEY` env)
**Raw:** `experiments_history/2026-08-14_deepseek-test/results/20260814T15*_deepseek_series.json`
**Sibling:** `docs/streamlake-kat-thinking-cache.md` (same suite against the StreamLake/KAT gateway)

Everything below is grounded in the official references (read before the runs) plus live measurements.

## Prior art (official refs)

- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) — request/response fields, `stream_options.include_usage`, `user_id`.
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) — `thinking:{type:enabled|disabled}` (default **enabled**, effort default **high**), `reasoning_effort: low|high|max`; `temperature/top_p` ignored in thinking mode; multi-turn CoT handling rules.
- [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/) — automatic, on by default; prefix units persisted at (1) request boundaries (end of user input / end of model output), (2) common-prefix detection, (3) fixed token intervals.
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) — v4-pro: hit **$0.003625/M**, miss **$0.435/M**, out **$0.87/M** (120× hit/miss gap).
- [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit) — `user_id` documented as KVCache isolation (see caveat below).

## Measured mechanics (Exact)

### Usage always arrives

- `usage` is on the **final streaming chunk automatically** — no `stream_options.include_usage` needed (unlike StreamLake/KAT).
- `prompt_tokens == prompt_cache_hit_tokens + prompt_cache_miss_tokens` on every request (verified on all 20 turns).

### Cache unit persistence

| Scale | Observed behaviour |
|---|---|
| Ladder (182-token prompt) | hit pinned at **128** (t2–t7), then **256** (t8): units persist lazily (fixed intervals / boundaries); the growing conversation suffix misses until a unit lands |
| Big (48 147-token prefix) | t1 cold (hit 0 or 128 common-prefix unit), t2+ **entire prefix hits** (48 128); miss = only the appended turn text (49–132 tokens) |

- Hits sit on the **exact 128-token lattice** (48 128 = 376×128).
- After a warm-up turn, hit ratio on the big prefix: **0.997–0.999**.

### Cost structure (the important part)

| Series | Cost | Note |
|---|---|---|
| big_default (6 turns, 48K prefix) | $0.0241 | **$0.0209 = cold turn 1** (miss 48 019) — 87% of the series |
| no_think (4 turns) | $0.0216 | same cold-turn dominance |
| isolation (2×2) | $0.0011 | both buckets already warm |

- Cold 48K pre-fill ≈ **$0.021**; warm turn ≈ **$0.0002**. ~100× difference.
- Latency: hit 1 172–3 282 ms vs cold 6 208–7 069 ms (4–5×) on the 48K prefix.

### Thinking mode

- `thinking:{type:"disabled"}` **works**: `reasoning_tokens = 0` on every turn (unlike the StreamLake/KAT gateway, which ignores the toggle).
- Disabled thinking also shrinks the template slightly (48 068 vs 48 147 prompt).
- Historical `reasoning_content` between two user messages **without tool calls is IGNORED by the API** — echoing it adds wire bytes but does not enter `prompt_tokens`.
- For requests carrying `tools`, `reasoning_content` is **echoed back** in all subsequent requests. The 400 that vendor docs attribute to a missing field is **misattributed** — re-probed 2026-09-12, it fires on a `tool_call` id the server never issued (see the correction in `docs/reasoning-round-trip-contract.md`). Keep the echo; never synthesise a `tool_call` id on replay.
- **Re-verified 2026-08-28** (live 400 on variant without the field) + cross-vendor matrix and the gateway rewrite: see `docs/reasoning-round-trip-contract.md`.

### `user_id` isolation — refuted on our account

- Docs claim KVCache isolation per `user_id`. Live test: two fresh `user_id`s (verify-iso-a, verify-iso-b) **both hit the full 48 128 prefix on turn 1** — cache is account-level shared on this account.
- Do not rely on `user_id` for cache separation.

## What smit/opencode does today (post cache-alignment)

- Sends `thinking:{type:"enabled"}` for deepseek-v4 (matches default think-on workflow).
- **Drops CoT bytes from the replay for assistant messages WITHOUT tool calls** (`transform.ts`) — the API ignores them anyway, so the per-turn miss tail stays text-only.
- **Keeps the full CoT echo for messages WITH tool calls** — the 400-guard.
- Does **not** send `prompt_cache_key` for the deepseek SDK route (dead field — never serialized, no isolation).
- Replay cap (`tool_output.replay_max_chars`, default 32K chars) + injection warn (>24 576 tokens) + prefix-reset warn — see `plans/2026-08-14-cache-miss-tail.md` and `plans/2026-08-14-cache-alignment.md`.

## Smit implications

1. **Cold turn is unavoidable and dominant** — a fresh session (or post-compaction prefix) pays ~full miss price once. Amortize by keeping sessions long-lived and stable.
2. **Compaction = one expensive re-prefill.** The prefix-reset warn (P4) flags it; schedule compaction deliberately, not eagerly.
3. **Don't bother echoing historical CoT without tools** — ignored and costs wire bytes.
4. **Never drop CoT for tool-call messages** — 400 error.
5. **Miss tail = appended turn only** when the prefix is stable: keep big stable blocks (system, tools) unchanged and order-stable; append new content at the end.

## How to re-run

```
python experiments/2026-08-14_deepseek-test/deepseek_test.py --series ladder
python experiments/2026-08-14_deepseek-test/deepseek_test.py --series big --turns 6
python experiments/2026-08-14_deepseek-test/deepseek_test.py --series no_think --turns 4
python experiments/2026-08-14_deepseek-test/deepseek_test.py --series isolation
python experiments/2026-08-14_deepseek-test/deepseek_test.py --series all
```

Requires `DEEPSEEK_API_KEY` in env. Results land in `experiments/2026-08-14_deepseek-test/results/` with per-turn rows + auto verification summaries (balance, lattice, hit ratio, cost).

---

# What a request actually costs (added 2026-10-05)

Measured on `d:/!!!` over one day, cross-checked against the provider's own
`/user/balance` endpoint. Companion plan: `plans/2026-10-04_files-api-and-tariff.md`.

## The tariff changes with the clock, and our model had no clock

Off-peak rates are **half** the peak price. Peak is a wall-clock window —
01:00-04:00 and 06:00-10:00 UTC, Monday through Friday, public holidays excluded
(api-docs.deepseek.com, pricing footnote 2). `getUsage` branched only on a
context threshold and never on the time, so the model could not express a
time-varying tariff at all.

| tariff (deepseek-flash) | predicted for the day | against actual |
|---|---|---|
| off-peak (what the model used) | $1.074 | 55% low |
| **PEAK** | **$2.149** | **10% low — closest** |

Peak/off-peak is exactly 2.0; the measured gap was 2.22x. The arithmetic itself
was never wrong: recorded/computed was **1.000** to the last digit. `provider/tariff.ts`
now selects by UTC clock, the schedule lives in config beside the rates, and
DeepSeek's peak block is **derived by doubling** the base so a re-priced table
needs no code edit.

## Cost decomposition — it is the thinking, not the context

One captured request (245 120 cache-hit, 304 fresh, 4 009 completion):

| | tokens | cost | share |
|---|---|---|---|
| cache hit | 245 120 | $0.000735 | 23.1% |
| cache miss | 304 | $0.000046 | 1.4% |
| **completion** | **4 009** | **$0.002405** | **75.5%** |

4 009 output tokens cost as much as the entire 245k context. Reasoning was 59.5%
of that output, and 82.3% of output on tool-calling turns. **The bill is paid for
thinking.** Any optimisation aimed at the context or at images is aimed at the
cheap 24.5%.

## Images: 74% of the bytes, 6.3% of the tokens

An image bills as at most **1024 tokens** regardless of its pixel size
(api-docs.deepseek.com vision docs), so fifteen base64 screenshots are ≤15 360
tokens — 6.3% of a 245k prompt — while being 5.77 MB of a 7.75 MB payload.

- Base64 in the request is **not** counted as text: 6.51 MB would be 1 705 723
  text tokens against an actual `prompt_tokens` of 638 553. Refuted by 2.7x.
- But base64 in a **TEXT block** would be the catastrophe: ~205 000 tokens for one
  image versus ≤1 024 as a file block. Nothing guards that path; it wants a WARN.
- Consecutive screenshots repeat: 7 of 13 `cua` frame pairs were pixel-identical,
  and only 2 of 13 had a diff small enough for a crop to pay. Skipping identical
  frames is a bandwidth win, not a money one.

## Files API: bytes, not money

`POST /files` (`purpose=user_data`, ≤64 MiB) → `file_id`, referenced as
`{"type":"file","file_id":"…"}`. The response carries **no status field** — there
is nothing to poll, so "ready" is established by asking (`files.retrieve`).
Limits: 25 GiB and 10 000 files per account; JPEG/PNG/GIF/**WebP**.

It removes 5.77 MB from every request and walks us away from the 48 MiB body
limit. It saves almost no money, because a 1024-token image on a warm cache is
$0.000046. Ranking it above reasoning as a cost optimisation would be wrong.

## What is still open

The residual 10% ($2.149 vs $2.390) is not explained locally. It needs
`platform.deepseek.com/usage` — the daily total, the model named on the charge,
and the per-token-type breakdown. Their cache-hit rate decides whether the
account is on peak pricing or the gap is in the provider's own deduction:
 `/user/balance` returns only `is_available` and `balance_infos`, no tariff.

`provider/balance.ts` carries the alarm for this: it compares our model against
the real balance over an 8-snapshot window at 15% tolerance, and was silent the
whole time this drift was running.
