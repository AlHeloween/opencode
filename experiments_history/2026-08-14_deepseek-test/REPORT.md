# DeepSeek — cache & thinking verification series report

**Date:** 2026-08-14 · **Script:** `experiments/2026-08-14_deepseek-test/deepseek_test.py`
**Model:** `deepseek-v4-pro` via `https://api.deepseek.com`
**Key:** `DEEPSEEK_API_KEY` from env (never logged)
**Refs read first:** create-chat-completion API ref, thinking_mode guide, kv_cache guide, pricing (api-docs.deepseek.com)

## Runs

| Series | Raw results |
|---|---|
| ladder (8 turns, 182-token prompt, think on) | `results/20260814T151216Z_deepseek_series.json` |
| big_default (6 turns, 48 147-token prefix, think on) | `results/20260814T151602Z_deepseek_series.json` |
| no_think (4 turns, 48 068-token prefix, thinking disabled) | `results/20260814T152110Z_deepseek_series.json` |
| isolation (2×2 turns, user_id A then B) | `results/20260814T152321Z_deepseek_series.json` |

## Verdicts vs API docs

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| D1 | `prompt_tokens == hit + miss` | **CONFIRMED** | `balanced_all: true` во всех 20 ходах |
| D2 | Auto context caching; hit = persisted prefix unit; miss = appended turn | **CONFIRMED** | big: hit 48 128 на весь префикс, miss = только новый ход (49–132 токена) |
| D3 | Historical `reasoning_content` ignored by API (no tool calls) | **CONFIRMED** | ladder echo 43–122 chars/turn, prompt grows +13.9/turn (text only); big echo до 8 834 chars, рост +22.6/turn |
| D4 | `thinking:{type:"disabled"}` выключает мышление | **CONFIRMED** | reasoning_tokens = 0 на всех ходах, echo 0 (в отличие от KAT-гейтвея) |
| D5 | `user_id` даёт KVCache-изоляцию | **НЕ ПОДТВЕРЖДЕНО** | verify-iso-a и verify-iso-b получили **полный хит 48 128 с первого хода** — кеш на этом аккаунте общий между user_id |
| D6 | Usage приходит автоматически на финальном чанке | **CONFIRMED** | без stream_options, usage на каждом финальном чанке |

## Механика 128-юнитов (мелкий масштаб)

Ladder: hit застрял на **128** (t2–t7), потом **256** (t8) — DeepSeek персистит prefix units на границах и по fixed intervals; растущий диалоговый суффикс остаётся miss, пока юнит не персистится. На большом префиксе юнит «конец user input» персистился после первого хода → t2+ покрывает весь префикс.

## Стоимость (v4-pro: hit $0.003625/M, miss $0.435/M, out $0.87/M)

| Series | est cost | структура |
|---|---|---|
| ladder (8) | $0.000552 | мелочь |
| big_default (6) | $0.024085 | **$0.0209 = холодный t1 (miss 48 019)** — 87% серии |
| no_think (4) | $0.021594 | $0.0209 = холодный t1 |
| isolation (2×2) | $0.001107 | оба бакета тёплые сразу |

Холодный первый ход на 48K-префиксе стоит ~$0.021 (miss-цена), все последующие — ~$0.0002. 128-кратная разница hit/miss цен подтверждена на практике.

## Latency

| | hit | cold |
|---|---|---|
| big | 1 172–3 282 мс | 6 208–7 069 мс |

Хит на 48K-префиксе в 4-5× быстрее холодного re-prefill.

## Сравнение: DeepSeek vs StreamLake/KAT

| Метрика | StreamLake KAT | DeepSeek v4-pro |
|---|---|---|
| usage в стриме | только с `include_usage` (иначе null) | всегда на финальном чанке |
| hit/miss поля | `cached_tokens` (null возможен) | `hit+miss == prompt` всегда |
| Ladder-кеш | 128/192, null-разрывы | залипает на 128→256 юнитах |
| Big-префикс hit ratio | 0.969–0.999 | 0.997–0.999 |
| Решётка хитов | 64-токенная | 128-токенная (точная) |
| Toggle мышления | **игнорируется** | **работает** |
| Исторический CoT | вырезается шаблоном | игнорируется API (эквивалент) |
| Изоляция кеша | `prompt_cache_key` бакеты работают | `user_id` не изолирует (аккаунт-level) |
| Холодный ход | null (латентность 3-4×) | miss 48K ≈ $0.021, латентность 4-5× |

Общее для обоих: miss = только добавленный текст хода; экономика определяется холодным первым ходом; стабильный префикс кешируется целиком.
