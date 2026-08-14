# DeepSeek: thinking vs prompt cache

**Status:** measured 2026-08-14 on `deepseek-v4-pro` via `https://api.deepseek.com`
**Script:** `experiments/deepseek-test/deepseek_test.py` (key from `DEEPSEEK_API_KEY` env)
**Raw:** `experiments/deepseek-test/results/20260814T15*_deepseek_series.json`
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
- For requests carrying `tools`, `reasoning_content` **MUST be passed back** in all subsequent requests — otherwise HTTP 400 ("must be passed back to the API").

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
python experiments/deepseek-test/deepseek_test.py --series ladder
python experiments/deepseek-test/deepseek_test.py --series big --turns 6
python experiments/deepseek-test/deepseek_test.py --series no_think --turns 4
python experiments/deepseek-test/deepseek_test.py --series isolation
python experiments/deepseek-test/deepseek_test.py --series all
```

Requires `DEEPSEEK_API_KEY` in env. Results land in `experiments/deepseek-test/results/` with per-turn rows + auto verification summaries (balance, lattice, hit ratio, cost).
