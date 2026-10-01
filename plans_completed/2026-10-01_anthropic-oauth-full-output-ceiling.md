# Anthropic OAuth: полный выходной лимит модели

<!-- intention: OpenCode ограничивает Anthropic OAuth-запросы устаревшими 64k -> OpenCode сохраняет рассчитанный моделью max_tokens без дополнительного OAuth-ограничения -->

```yaml
Keywords: anthropic-oauth 0.32, max-tokens 0.26, request-shape 0.18, regression-test 0.14, cache-stability 0.10
Semantic dominant: Убрать устаревший OAuth-лимит 64k, не меняя вход, refresh, заголовки и транспорт Anthropic.
md5: 6f1a934e75c24d98b81e207ac3f54e6d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 4b382dd90e7c4f67a9612538bd1ae054
```

## Основание

- ✓ `git show 42aee39175`: oh-my-pi удалил OAuth-only clamp и передаёт полный `model.maxTokens`; вход и refresh этим коммитом не менялись.
- ✓ CodeGraph `transformOAuthRequest`: в OpenCode ограничение локализовано в `packages/opencode/src/plugin/anthropic.ts`, имеет один вызов и один узкий тест.
- ✓ baseline `cmd_runner` `20261001T123144Z_e8ce28c5`: `test/plugin/anthropic-auth.test.ts`, 8 pass, 0 fail, 69 assertions.

## Контракт

- A1: `transformOAuthRequest` сохраняет `max_tokens: 100_000` без понижения до `64_000`.
- A2: OAuth PKCE, обмен/refresh токенов, fingerprint-заголовки, billing/CCH и gateway-маршрут не меняются.
- A3: байты запроса после трансформации по-прежнему проходят существующий transport-тест.

## План

- [x] T1 — сначала заменить ожидание 64k на полный входной лимит и зафиксировать EXPECTED_FAIL.
- [x] T2 — удалить OAuth-only константу и clamp одной строкой.
- [x] T3 — обновить `docs/architecture.md` и `_progress_log.md`.
- [x] T4 — выполнить узкий тест; ожидается 8 pass, 0 fail, затем проверить diff и рабочее дерево.
- [x] T5 — закоммитить только файлы этой задачи и перенести план в `plans_completed/`.

## Риски и откат

- Риск: модель/endpoint отвергает заявленный каталогом лимит. Ограничение остаётся обязанностью слоя модели, который сформировал `max_tokens`; этот патч убирает только повторный OAuth clamp.
- Риск KV cache: отсутствует — меняется числовое поле mutable request body, системный префикс и список инструментов не меняются.
- Откат: восстановить clamp и тестовое ожидание 64k одним revert коммита задачи.

## Smoke Tests

1. Baseline: `bun test test/plugin/anthropic-auth.test.ts` из `packages/opencode` → PASS.
2. Test-first: ожидание `100_000` при старом коде → FAIL с фактом `64_000`.
3. Post-change: тот же файл → 8 pass, 0 fail.

## Результат

- ✓ EXPECTED_FAIL `cmd_runner` `20261001T123240Z_22b58a3c`: 7 pass, 1 fail; получено `64_000`, ожидалось `100_000`.
- ✓ PASS `cmd_runner` `20261001T123307Z_de4b13b5`: 8 pass, 0 fail, 69 assertions; `bytes_dropped=0`, `truncated=false`.
- ✓ OAuth-вход, refresh, заголовки, CCH, gateway и API-key путь не изменялись.
