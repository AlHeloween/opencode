# Plan: Cache-Miss Tail — разрулить экономику промахов кеша в агентных сессиях

- plan_id: 6e2f1b9a-4c7d-4f1e-9a3c-000000000001
- revision: 1
- created_by: plan_mode
- state: ACTIVE (authorized 2026-08-14 via G4)
- date: 2026-08-14

## Goal

Сократить miss-хвост промпт-кеша (DeepSeek + OpenAI-совместимые гейтвеи) в сессиях с тяжёлыми tool-циклами: уменьшить объём крупных блоков нового контента, вливающихся в replay-историю, выяснить причину 100%-промахов на openai-совместимом гейтвее, и сделать метрики кеша честными (per-request, не смешанные).

## Контекст (что уже установлено, Exact из wire+DB)

- Медианный запрос DeepSeek: hit 99.5-99.9%. Максимальное отклонение: **38.6% промаха** (miss 68 735 токенов) при инжекции крупного блока; miss = размер впрыснутого блока (DeepSeek кеширует только персистентные prefix units).
- 5.3% miss-токенов = 87% стоимости входа (hit $0.003625/M vs miss $0.435/M, deepseek-v4-pro).
- pasha-coder (streamlake, openai-совместимый): 9 первых сообщений с cache.read=0 (100% miss) при стабильном `prompt_cache_key`.
- `message.data.tokens` = последний step usage (processor.ts:599) — метрика message-level смешивает кумулятивный cache.read с однократным input.
- Хук `toolOutputMaxChars` в `message-v2.ts:780/937` существует, но ни один вызов не передаёт его — крупные tool-outputs идут в replay целиком.

## Premises (⊆ G)

- C1 [Exact, wire]: miss на следующем запросе ≈ размер нового блока, впрыснутого в контекст (наблюдено 4 раза: +69K→68 735 miss; +37K→37 061; +32K→32 097; +60K→60 624).
- C2 [Exact, pricing docs]: miss-цена DeepSeek v4-pro в 120× выше hit-цены.
- C3 [Exact, code]: `toolOutputMaxChars` не передаётся ни одним callsite (`message-v2.ts:780`, вызовы в `prompt.ts`).
- C4 [Exact, DB]: pasha-coder 9 сообщений cache.read=0; SDK-маппинг `cached_tokens→cache.read` существует (`openai-compatible-chat-language-model.ts:286`).
- C5 [Exact, code]: `processor.ts:599` перезаписывает message tokens последним step-usage.
- C6 [Exact, code, explore-валидация]: `cache.write` хардкодится в `undefined` в openai-compatible SDK (`openai-compatible-chat-language-model.ts:288`) — метрика write в принципе не собирается.

## Open questions

- Q1: Возвращает ли streamlake-gateway `usage`/`cached_tokens` в стриме вообще? (T1)
- Q2: Какой порог `toolOutputMaxChars` безопасен для качества ответов? (T2, эксперимент)

## Prior art (REUSE.BEFORE)

- DeepSeek Context Caching guide (api-docs.deepseek.com/guides/kv_cache): persistence только на границах запросов/common-prefix; best-effort.
- OpenAI Prompt caching guide: `prompt_cache_key` routing stickiness (~15 RPM/ключ); min prefix 1024-2048; **compaction конфликтует с кешем**.
- Локально: `Truncate.Service` (`src/session/tools.ts:301`, второй сайт `src/tool/tool.ts:140-147`) уже пишет крупные выводы в файл (`outputPath`), дефолты 2000 строк / 50KB (`src/tool/truncate.ts:16-17`) — переиспользуем для дайджестов. ВАЖНО: наблюдаемые блоки 32K-68K токенов — это агрегаты многих выводов за ход (каждый ≤50KB), поэтому нужен и per-output cap (T2), и per-turn guard (T3).
- Локально: checkpoint `modelMessageCounts` + `reusablePrefixLength` — конверсия сообщений уже fingerprint-aware (message-v2.ts:855 cacheKey включает toolOutputMaxChars).

## Smoke Tests (PRE_FLIGHT, до первой правки)

- baseline-1: `cmd_runner start -- bun typecheck` из `packages/opencode` → exit 0 [записать Actual].
- baseline-2: `cmd_runner start -- bun test test/session/ -t "message"` из `packages/opencode` → exit 0.
- baseline-3: записать в план текущие значения из wire (hit/miss последнего хода сессии deepseek) как эталон для post-сравнения.

## Tasks

| Task | Что | Файлы | Deps | Oracle | Status |
|---|---|---|---|---|---|
| T1 | Диагностика кеша streamlake/openai-совместимого гейтвея | `plans/2026-08-14-cache-miss-tail/t1_streamlake_cache_diagnosis.md` | C4, Q1 | отчёт с решением | **[x] DONE: H3 — usage отсутствует в wire** |
| T2 | Дефолтный кап tool-output в replay (toolOutputMaxChars + digest + outputPath) | `plans/2026-08-14-cache-miss-tail/t2_tool_output_replay_cap.md` | C1, C3 | unit-тест truncation | **[x] DONE: typecheck PASS + message-v2 тесты 41/41** |
| T3 | Guard бюджета хода: warn при Δprompt > порога за ход | `plans/2026-08-14-cache-miss-tail/t3_turn_budget_guard.md` | C1 | unit-тест порога | **[x] DONE: cache-injection.test.ts 7/7** |
| T4 | Честные метрики: агрегация tokens по шагам (+cache.write маппинг) | `plans/2026-08-14-cache-miss-tail/t4_honest_cache_metrics.md` | C5, C6 | unit-тест: message.tokens == Σ step tokens | **[x] DONE: агрегация + cacheWriteTokens маппинг + тесты** |

Порядок: T1 (диагностика, read-only) → решение по фиксу → T2 → T3 → T4.

## Outcome contract

- OC1: после T2 ход, впрыскивающий >32K chars tool-output, добавляет в replay ≤ ~8K токенов (oracle: wire prompt_tokens delta до/после, gateway per-response).
- OC2: T1 выдаёт доказанный вердикт (если mapping bug — исправлен с тестом).
- OC3: T4 — `message.data.tokens` агрегируется по шагам (unit test PASS).
- coverage_threshold: 1.0 для OC1..OC3.

## Risks (не блокируют MODIFY, блокируют closure)

- R1 (unresolved_safety_risk): обрезка tool-outputs может ухудшить качество (модель теряет детали). Митигация: digest + outputPath + конфигурируемый порог; T2-эксперимент Q2.
- R2 (architecture_concern): [KV-CACHE RISK] изменение конверсии сообщений меняет байты replay → возможен один холодный ход после деплоя. Митигация: cacheKey в message-v2.ts:855 уже включает toolOutputMaxChars; задокументировать.
- R3 (unresolved_external_dependency): streamlake-гейтвей — внешняя система; если кеша нет на их стороне, наш фикс ограничен стабильностью `prompt_cache_key`.
- R4 (unresolved_safety_risk): исторические строки БД остаются со смешанной метрикой — пометить в T4, не переписывать.

## Verification (G8 oracles, 2026-08-14)

- [x] smoke-базлайн: `bun typecheck` из packages/opencode ДО правок — exit 0 (cmd_runner run `20260814T131807Z_2ea8598e`).
- [x] post-impl typecheck — exit 0 (cmd_runner run `20260814T133958Z_8dcbcd51`).
- [x] `bun test test/session/cache-injection.test.ts test/session/message-v2.test.ts test/session/processor-effect.test.ts` — **54 pass, 0 fail** (cmd_runner run `20260814T133958Z_ce3c3ca6`).
- [ ] OC1 (wire-пост-сравнение): замер Δprompt на ход с крупными tool-outputs в живой сессии — ожидается после перезапуска opencode с новым билдом (проверяется в следующей тяжёлой сессии: T3-warn в логе + Δblock ≤ ~8K токенов/вывод).
- Пометка: LSP-диагностика `floatingEffect` в prompt.ts (6 шт., elog.error в catch) — pre-existing, не tsgo-ошибки; вынесена в отдельный вопрос.

## Clean state (после G9)

- Планы задач — в этом каталоге; после имплементации и PASS ораклов мастер-план → `plans_completed/`.
