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

## What smit does today

- Sends `reasoning_content` back on later assistant messages (OpenAI-compat field).
- Does **not** send `chat_template_kwargs.preserve_thinking` or `enable_thinking`.
- So we match KAT **default interleaved**: echo is on the wire, template **strips** old think. Prefix stays byte-stable. Model **re-thinks every turn**.

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
2. `cached_tokens: null` is **not** a miss of the prefix — stream still 200, often ~same latency. Do not treat null as “cache broken”.
3. Echoing `reasoning_content` **without** a working `preserve_thinking` does not change `prompt_tokens`. Smit already does this; it is not the 17/33/49/65 shift.
4. On **this** StreamLake coding gateway, `chat_template_kwargs` did not change think-off or prefix growth. Do not ship a smit default of `preserve_thinking: true` until a host actually inflates `prompt`.
5. `prompt_cache_key` still isolates buckets (`:default` vs `:no_think` vs `:preserve` plus earlier `:lab-a` / `:lab-b` tests).

## Smit implication

Leave production as **default interleaved** until Vanchin documents / forwards `chat_template_kwargs`. If they later honor `preserve_thinking`, expect:

- fewer repeat reasoning tokens,
- prefix that **grows every turn** (old think stays),
- `cached_tokens` may sit on **17 / 33 / 49 / 65 Ki** instead of 16 / 32 / 48 / 64.

That change is `[KV-CACHE RISK]`: system prefix stays, conversation prefix after first assistant think becomes unique every hop.

## How to re-run

```
python bin/pasha_test.py --mode all --turns 8
python bin/pasha_test.py --mode default
python bin/pasha_test.py --mode no_think
python bin/pasha_test.py --mode preserve
```
