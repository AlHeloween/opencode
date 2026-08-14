# T1 — Диагностика кеша streamlake / openai-совместимого гейтвея

## VERDICT (2026-08-14): H3 — usage отсутствует в ответе гейтвея

**Evidence [Exact, wire]:**
- Upstream model за гейтвеем: `kat-coder-pro-v2.5` (per-response `2026-08-14T20-19-05-132Z-2ec5dc11-….json`).
- Каждый streaming-chunk содержит `"usage":null`; grep `"usage":\{` по всей эре 20-19..20-22Z → **0 файлов**. Финального usage-чанка нет.
- Следствие: SDK не получает `prompt_tokens`/`cached_tokens` → opencode пишет `cache.read = 0` для этих запросов. **"9 сообщений со 100% miss" — артефакт отчётности, а не доказанный промах**: реальное состояние кеша гейтвея неизмеримо с нашей стороны.
- Аномалия: в поздних сообщениях (msg_000386fc) `cache.read=49152` при отсутствии usage — SDK-side оценка; происхождение требует отдельного ревью версии AI SDK (вне скоупа, помечено Unknown).

**Action:**
1. Нет mapping-bug для фикса (мапить нечего). R3 подтверждён: кеш-метрика этого провайдера недоступна, пока владелец гейтвея не начнёт возвращать `usage` (в т.ч. `prompt_tokens_details.cached_tokens`).
2. Экономический риск покрывается T2/T3 (обрезка replay-блоков) — единственное, что мы можем сделать на своей стороне.
3. Запрос владельцу гейтвея: вернуть usage в финальном чанке.

## Abstract definition

Установить, почему первые assistant-сообщения провайдера `pasha-coder` (base `https://vanchin.streamlake.ai/api/gateway/coding/v1/chat/completions`) имеют `tokens.cache.read = 0` при стабильном `prompt_cache_key`.

## Hypotheses → результат

- H1 mapping bug → ОТКЛОНЕНО (usage в wire отсутствует физически).
- H2 gateway no-cache → недоказуемо без usage; гейтвей может кешить скрыто.
- H3 usage absent → **ПОДТВЕРЖДЕНО**.

## Test cases

- t1.1 DONE: grep per-response эры 20-19..20-22Z — usage отсутствует (`"usage":null` во всех чанках).
- t1.2 N/A (фикса маппинга нет).
- t1.3 DONE: вердикт задокументирован в этом файле + мастер-плане.
