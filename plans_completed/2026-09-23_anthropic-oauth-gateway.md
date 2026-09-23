# Anthropic OAuth через gateway

<!-- intention: OAuth-запросы Anthropic идут из OpenCode напрямую через customFetch -> запросы проходят через существующий gateway с сохранением тела и потоковой семантики -->

state: COMPLETE
scope: `packages/opencode/src/plugin/anthropic.ts`, адресный тест, документация маршрута

## Основания

- CONFIRMED (✓ codegraph, `provider/provider.ts:1599-1605`): `customFetch` имеет приоритет над `__gatewayFetch`.
- CONFIRMED (✓ baseline `git show 3cdf350548:packages/opencode/src/plugin/anthropic.ts`, строки 415–417, 461–465): до этой задачи OAuth-хук вызывал обычный `fetch` и выдавал `Uint8Array`.
- CONFIRMED (✓ чтение `gateway/adaptive-client.ts:250-251, 733-736, 887-891`): gateway распознаёт и отправляет строковое тело.
- CONFIRMED (✓ чтение `session/acquired-item.ts:100-104`): поздняя TDA-правка тела не применяется к `anthropic`.
- CONFIRMED (✓ cmd_runner `20260923T140124Z_6180a88b`): исходный `anthropic-auth.test.ts` — 6 pass, 0 fail.

## Контракт и задачи

1. Передать уже сформированный OAuth-запрос в `__gatewayFetch` при наличии gateway. Сохранить прямой `fetch` при отсутствии gateway.
2. Передавать тело как UTF-8 строку с теми же байтами после расчёта CCH, чтобы gateway определял `stream` и отправлял тело.
3. Адресным тестом доказать выбор gateway, точное тело/заголовки на локальном HTTP-приёмнике через настоящий `wrapFetch` и резервный маршрут. Никаких настоящих токенов и запросов Anthropic.

## Риски и проверка

- Риск: смена типа тела меняет байты. Фальсификатор: кодирование выходной строки отличается от ранее вычисленных байтов либо отличается CCH.
- Риск: gateway не получает потоковый флаг. Фальсификатор: `requestMetadata` возвращает `streaming: false` для потокового OAuth-запроса.
- Риск: запрос уходит напрямую. Фальсификатор: тестовый `__gatewayFetch` не вызывается или вызывается обычный `fetch`.
- Baseline: `bun test test/plugin/anthropic-auth.test.ts` из `packages/opencode` — 6/0.
- Post-change: тот же адресный тест — 8/0, 69 assertions (cmd_runner `20260923T141157Z_712d8c26`), `bun typecheck` exit 0 (cmd_runner `20260923T141157Z_0a7cb34e`), scoped `git diff --check`.
- Rollback: вернуть только изменения этого плана в `plugin/anthropic.ts`, адресном тесте и документации.

## Граница

Этот шаг соединяет OAuth-запрос с gateway. Локальный wire-тест доказывает сохранение сформированного тела на HTTP/1.1, но не отдельную корректность CCH по ответу Anthropic или работу HTTP/2 и HTTP/3. Механизм нескольких учётных записей и политика обновления токенов oh-my-pi остаются отдельным остатком; данный план не заявляет их готовыми.
