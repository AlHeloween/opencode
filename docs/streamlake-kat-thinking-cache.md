# StreamLake / KAT: thinking vs prompt cache

**Status:** measured 2026-08-14 on `pasha-coder` / `ep-kneqk9-1786632248553436783`  
**Smoke:** `python bin/pasha_test.py --mode all --turns 8`  
**Raw:** `experiments/cache-tests/results/20260814T142502Z_think_modes.json`

This is the small detail we were missing. It is not `cache_control` and not whether we echo `reasoning_content` in JSON.

## Prior art

- [KAT-Coder-V2.5-Dev — Preserve Thinking](https://huggingface.co/Kwaipilot/KAT-Coder-V2.5-Dev): think is **on by default**. Default template is **interleaved** — only the think for the **latest** user message is kept. Historical `reasoning_content` is dropped unless `chat_template_kwargs.preserve_thinking = true`. Disable think with `enable_thinking: false`.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): automatic from **1024** tokens, hits in **128-token** increments. `cached_tokens` is the largest 128-multiple of the matching prefix, not the full shared length.
- `prompt_cache_key` is a **routing/namespace** hint, not a prefix hash.

## The 16 / 17 / 32 / 33 / 48 / 49 / 64 / 65 grid

Those are **kibitokens** (`× 1024`), sitting on the 128-token lattice:

| even (no think in prefix) | tokens | +1 Ki if think enters the hashed prefix |
|---|---:|---:|
| 16 | 16384 | 17 → 17408 |
| 32 | 32768 | 33 → 33792 |
| 48 | 49152 | 49 → 50176 |
| 64 | 65536 | 65 → 66560 |

`49152 = 48×1024 = 384×128` — Exact HIT from the large-prefix lab.  
On the short ladder we saw **128** then **192** (`128+64`). Still 128-token steps.

+1 Ki ≈ eight blocks of 128. That is what you would expect if **historical thinking were in the template**.

## What smit does today (post 2026-08-15)

- **Drops `reasoning_content` from the replay for ALL KAT assistant messages** — no 400 even with tool calls (unlike DeepSeek, which requires the CoT back for tool-call messages).
- Does **not** send `chat_template_kwargs.preserve_thinking` or `enable_thinking` (gateway ignores them anyway).
- So we match KAT **default interleaved**: template **strips** old think. Prefix stays byte-stable. Model **re-thinks every turn** — but with **fewer output reasoning tokens** because it doesn't see its own historical CoT.

### Reasoning echo policy across vendors (transform.ts `normalizeMessages`)

| Route | No tool calls | Tool calls |
|---|---|---|
| DeepSeek, MIMO (any openai-compatible route) | drop CoT bytes (ignored / not required) | **echo required** (400 without — vendor docs) |
| Everyone else on openai-compatible routes (KAT, Qwen, zen-proxied Kimi/GLM/MiniMax/hy3, LiteLLM-style proxies) | **drop entirely** | **drop entirely** |
| GitHub Copilot (opaque `reasoning_text`) | keep (opaque replay) | keep (opaque replay) |
| Anthropic / other SDK routes | untouched | untouched |

Evidence: KAT live matrix (this doc), DeepSeek + MIMO official docs, Qwen official docs
("do not add the reasoning_content field when you add to the context"), zen live
matrix 2026-08-15 (`experiments/cache-alignment-smoke/smoke_zen_reasoning_echo.py`).

### Why we drop the echo (live verified 2026-08-15)

| Scenario | prompt | output reasoning | duration |
|---|---:|---:|---:|
| t2 **with echo** (old behavior) | 73 | **142 rtok** | 1768ms |
| t2 **without echo** (new) | 73 | **50 rtok** | 1042ms |
| t2 empty echo | 73 | 120 rtok | 1710ms |

Tool-call replay (assistant with `tool_calls`): no-echo accepted **without 400**, prompt **78 vs 101** (echo added 23 CoT tokens to billed input).

**Conclusion:** echoing historical `reasoning_content` to KAT is unnecessary, adds input bytes for tool-call replays, and makes the model re-think longer (more output tokens billed). Drop it.

### Contrast with DeepSeek

DeepSeek's official docs ([Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)) require `reasoning_content` back for tool-call messages (400 otherwise) and ignore it for non-tool messages. KAT does **neither** — it accepts requests without the echo in all cases. See `docs/deepseek-thinking-cache.md` for the DeepSeek rules.

## Live matrix (this host)

Official OpenAI client → `https://vanchin.streamlake.ai/api/gateway/coding/v1`.  
Key from `bin/auth.json` `pasha-coder.key`. Start ~132 prompt tokens. Separate `prompt_cache_key` per mode (`…:default` / `:no_think` / `:preserve`).  
`reasoning_content` echoed every turn in all modes.

### default (no kwargs) — smit today

| t | prompt | cached | Ki | reason | echo | ms |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 132 | — | — | 30 | 127 | 1520 |
| 2 | 150 | — | — | 24 | 99 | 931 |
| 3 | 170 | **128** | 0.125 | 27 | 114 | 722 |
| 4 | 190 | 128 | 0.125 | 13 | 39 | 654 |
| 5 | 210 | 128 | 0.125 | 13 | 39 | 574 |
| 6 | 230 | **192** | 0.188 | 33 | 127 | 906 |
| 7 | 250 | — | — | 13 | 38 | 738 |
| 8 | 270 | 192 | 0.188 | 13 | 39 | 593 |

Prompt grows **+20 / turn** (user+assistant text only). Echo chars do **not** enter `prompt_tokens`.

### `enable_thinking: false`

| t | prompt | cached | reason | echo | ms |
|---|---:|---:|---:|---:|---:|
| 1 | 132 | 128 | **36** | 145 | 1122 |
| 2 | 150 | — | 13 | 39 | 748 |
| 3 | 170 | 128 | 21 | 80 | 873 |
| 4 | 190 | 128 | 22 | 93 | 732 |
| 5 | 210 | 128 | 42 | 182 | 2058 |
| 6 | 230 | 192 | 15 | 52 | 637 |
| 7 | 250 | — | 13 | 39 | 800 |
| 8 | 270 | — | 16 | 52 | 839 |

**Think did not turn off.** Same prompt ladder 132, 150, 170… Gateway likely **ignores** `enable_thinking` on this coding endpoint (or forces think for KAT).

### `preserve_thinking: true`

| t | prompt | cached | reason | echo | ms |
|---|---:|---:|---:|---:|---:|
| 1 | 132 | 128 | 23 | 85 | 643 |
| 2 | 150 | 128 | 15 | 50 | 604 |
| 3 | 170 | 128 | 21 | 80 | 682 |
| 4 | 190 | — | 16 | 52 | 837 |
| 5 | 210 | 192 | 13 | 39 | 571 |
| 6 | 230 | 192 | 26 | 111 | 929 |
| 7 | 250 | — | 39 | 175 | 972 |
| 8 | 270 | — | 28 | 119 | 969 |

**Prompt still +20 / turn.** Historical think did **not** appear in billed prefix. No jump to 17/33/49/65 Ki. Either:

1. Vanchin coding gateway **does not forward** `chat_template_kwargs` to the KAT template, or  
2. They preserve think in KV but **omit it from `prompt_tokens`** (we cannot see that from usage alone).

We cannot claim `preserve_thinking` works on this host until `prompt` grows with echo or we see 49/65 Ki cache.

## What we can claim (Exact)

1. Cache accounting is **128-token steps** (OpenAI-compat). Short run: 128 → 192. Long run: 49152 (= 48 Ki).
2. `cached_tokens: null` is **not** a miss of the prefix — stream still 200, often ~same latency. Do not treat null as "cache broken".
3. Echoing `reasoning_content` to KAT **is unnecessary** — the gateway accepts requests without it in all cases (no tool-call 400, unlike DeepSeek). Dropping it **reduces output reasoning tokens** (model re-thinks less) and **saves input bytes** on tool-call replays.
4. On **this** StreamLake coding gateway, `chat_template_kwargs` did not change think-off or prefix growth. Do not ship a smit default of `preserve_thinking: true` until a host actually inflates `prompt`.
5. `prompt_cache_key` still isolates buckets (`:default` vs `:no_think` vs `:preserve` plus earlier `:lab-a` / `:lab-b` tests).

## Smit implication

**Drop `reasoning_content` echo for KAT** (implemented in `transform.ts` `normalizeMessages`, keyed on `@ai-sdk/github-copilot` npm + streamlake/vanchin URL). This:

- saves input bytes on tool-call replays (CoT no longer billed),
- reduces output reasoning tokens (model doesn't re-think over its own historical CoT),
- is faster (1042ms vs 1768ms in live tests),
- is safe (no 400, correct answers in both plain and tool-call scenarios).

If Vanchin later honors `preserve_thinking`, expect:

- fewer repeat reasoning tokens,
- prefix that **grows every turn** (old think stays),
- `cached_tokens` may sit on **17 / 33 / 49 / 65 Ki** instead of 16 / 32 / 48 / 64.

That change is `[KV-CACHE RISK]`: system prefix stays, conversation prefix after first assistant think becomes unique every hop.

## How to re-run

### Cache ladder (this doc)

```
python bin/pasha_test.py --mode all --turns 8
python bin/pasha_test.py --mode default
python bin/pasha_test.py --mode no_think
python bin/pasha_test.py --mode preserve
```

### Reasoning echo experiment (2026-08-15)

```
python experiments/cache-alignment-smoke/smoke_kat_reasoning_echo.py
```

Compares turn-2 with echo vs without echo (plain + tool-call scenarios) — acceptance, prompt tokens, output reasoning tokens, duration.
