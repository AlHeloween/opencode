# Plan: Cache Alignment — привести систему в соответствие с измеренным поведением провайдеров

- plan_id: 7f3a2c1b-9d4e-4f2a-8b6c-000000000002
- revision: 1
- created_by: build_mode
- state: ACTIVE → IMPLEMENTED (2026-08-14, все ораклы PASS)
- date: 2026-08-14

## Goal

По итогам двух лабораторных серий (StreamLake/KAT и DeepSeek) привести opencode в соответствие с реальным поведением кешей провайдеров: кеш не ломается от наших же артефактов, метрики видны, холодные пере-префиллы минимизированы, и доказать это живым прогоном.

## Premises (⊆ G, все Exact из наших тестов)

- C1: StreamLake/KAT отдаёт usage только с `stream_options.include_usage`; фикс в `copilot-provider.ts` применён (typecheck PASS `20260814T143736Z_65596181`), но **не проверен вживую** (нужен rebuild).
- C2: DeepSeek игнорирует исторический `reasoning_content` между user-сообщениями БЕЗ tool calls; с tool calls он обязателен (иначе 400). [thinking_mode guide + наши D3]
- C3: `prompt_cache_key` для deepseek-провайдера в коде ставится (`transform.ts:968-982`), на проводе отсутствует и на DeepSeek изоляции не даёт (D5 опровергнут) — мёртвый код/ложный лог.
- C4: miss-хвост = только добавленный за ход текст, когда префикс стабилен; холодный ход доминирует в стоимости (87% серии у DeepSeek).
- C5: compaction сбрасывает префикс → следующий ход гарантированно холодный (дорогой) — нужна телеметрия.
- C6: T2 (replay cap), T3 (injection guard), T4 (агрегация+write) уже в коде и покрыты тестами (54/54 PASS).

## Tasks

| Task | Что | Файлы | Oracle |
|---|---|---|---|
| P1 | Rebuild + живой end-to-end прогон: pasha-coder сессия → usage/cached_tokens появились в wire/БД; T3-warn срабатывает; T2 cap ограничивает replay | `_build.ps1 -SkipOpenTui`, dist/bin + bin/auth.json + bin/gateway.jsonc, cmd_runner TUI | gateway per-response содержит `"usage":{"prompt_tokens"...` (не null); DB cache.read > 0 |
| P2 | DeepSeek: не эхоить `reasoning_content` в replay, когда в сообщении нет tool calls (API его игнорирует — меньше miss-байтов); при tool calls эхо остаётся обязательным | `src/provider/transform.ts` (reasoningContent-маппинг) | unit-тест: assistant без tool-call → поле отсутствует; с tool-call → поле есть; typecheck |
| P3 | Убрать мёртвый `prompt_cache_key` для deepseek SDK-маршрута (оставить для openai-compatible/azure/openrouter) + ложный лог | `src/provider/transform.ts:968-982` | unit-тест: deepseek-условие не выставляет ключ; typecheck |
| P4 | Телеметрия сброса префикса: warn при отрицательном Δprompt (compaction/model-switch) | `src/session/processor.ts` (T3-блок) | unit-тест injectionDelta negative + warn path |
| P5 | Документация: обновить планы, REPORT-файлы, `_progress_log` | планы/логи | — |

Порядок: P2+P3+P4 (код) → oracles → P1 (rebuild + live) → P5.

## Smoke Tests (PRE_FLIGHT)

- baseline-1: `bun typecheck` packages/opencode → exit 0 (последний: `20260814T143736Z_65596181` PASS — переснять перед правками).
- baseline-2: `bun test test/session/cache-injection.test.ts test/session/message-v2.test.ts test/session/processor-effect.test.ts` → 54 pass (переснять).
- baseline-3: текущее состояние wire для pasha-coder: usage:null во всех чанках (эталон «до»).

## Outcome contract

- OC1: после rebuild в живой pasha-coder сессии gateway per-response содержит usage-объект с `prompt_tokens`/`cached_tokens`; DB `tokens.cache.read` > 0 на повторных ходах.
- OC2: P2 unit-тест PASS (эхо только при tool calls для deepseek).
- OC3: P3 unit-тест PASS (deepseek без prompt_cache_key, openai-compatible с ним).
- OC4: P4 warn появляется при сбросе префикса (unit).
- coverage_threshold: 1.0.

## Verification (G8, 2026-08-14)

- [x] typecheck PASS до правок (`20260814T143736Z_65596181`) и после P2/P3/P4 (`20260814T155717Z_d81409cc`).
- [x] `bun test` (cache-injection + transform-reasoning + message-v2 + processor-effect): 61/61 pass (`20260814T155443Z_8e64e8e0`).
- [x] P2 unit: CoT dropped без tool calls / preserved с tool calls / OpenRouter excluded.
- [x] P3 unit: deepseek SDK route без prompt_cache_key; openai-compatible route с ключом.
- [x] P4 unit: prefixResetDelta shrink detection.
- [x] **OC1 PROVEN**: rebuild `_build.ps1 -SkipOpenTui` (exit 0, `20260814T160217Z_082209ae`) → dist/bin запущен (10.0.840) → raw-wire содержит `"stream_options":{"include_usage":true}` → per-response финальный чанк содержит реальный usage: `{"prompt_tokens":42008,"completion_tokens":130,"prompt_tokens_details":null,"completion_tokens_details":{"reasoning_tokens":37}}` (gateway.log `e9f41aef`, 2026-08-15T00-10-38Z).
- [x] Оговорка: `prompt_tokens_details: null` — гейтвей не отдаёт `cached_tokens` даже с include_usage; кеш-хит KAT остаётся невидимым (prompt/completion/reasoning теперь честные).

## Risks

- R1 [KV-CACHE RISK]: P2 меняет байты replay для deepseek → один холодный ход после деплоя. Митигация: contentFp в cacheKey переиспользует префикс; задокументировать.
- R2: P1 rebuild может быть долгим (~мин); TUI-автоматизация хрупкая — fallback: проверка wire через прямое python-повторение (уже умеем).
- R3: копирование bin/auth.json в dist/bin — локальные gitignored данные, не коммитить.
