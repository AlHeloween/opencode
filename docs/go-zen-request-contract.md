# Go/Zen: параметры кеша и заголовки

Срез: 2026-10-15. Изменение исходников по плану `2026-10-14_go-zen-cache-and-headers`; установка в живой `bin/` — отдельная операция.

## Измеренный контракт

✓ HTTP responses и source → установленный SDK → HTTP подтверждают:

| Go model alias | Наблюдаемый upstream | Default body option |
|---|---|---|
| `glm-5.3-flash` | Perplexity `perplexity/glm-5.3-flash` | `prompt_cache_options: {mode: "implicit", ttl: "30m"}` |
| `glm-5.3` | Fireworks `accounts/fireworks/models/glm-5p3` | `prompt_cache_options: {mode: "implicit", ttl: "24h"}` |

Оба source-запроса получили HTTP200. Flash отверг `prompt_cache_retention` и `ttl:"24h"`; явный режим без content-part breakpoint также получил HTTP400. Для GLM-5.3 принятие `24h` не доказывает применения поля или сутки хранения. Кеш-хиты прежнего немедленного повтора не измеряют TTL. Маршрут выбирает сервис Go; таблица описывает ответы опыта, а не гарантированный выбор upstream.

Для остальных моделей Go/Zen неподтверждённый TTL не задаётся. Диалект определяется SDK: native `@ai-sdk/openai` принимает camelCase `promptCacheKey`/`promptCacheRetention`, compatible SDK — wire fields. Явные настройки проходят существующий merge; корректность конкретного серверного режима проверяется отдельно. Anthropic cache markers сохраняются для настоящего Anthropic SDK; общие маркеры для всего opencode-семейства удалены.

## Заголовки Go/Zen

✓ Локальный HTTP oracle настоящего LLM/service и SDK проверяет соответствие `external/opencode-1.19.0/packages/opencode/src/session/llm/request.ts:187-205`:

- `x-opencode-session-id`, `x-opencode-session` — session ID;
- `x-opencode-request` — message ID, `x-opencode-project` — project ID;
- `x-opencode-client` — фактический `OPENCODE_CLIENT`, default `cli`;
- при parent — `x-opencode-parent-session-id` и `x-parent-session-id`;
- `User-Agent` — `opencode/<наша версия>`; SDK добавляет свою версию и runtime suffix.

Owned ветка не добавляет `x-request-id`, `x-session-id`, `x-session-affinity`. Существующие Novita grouping, OpenRouter cache lease, response-cache и внутренний TDA сохраняются; model/plugin headers имеют прежний приоритет. Новые owned headers не отправляются сторонним провайдерам. Reference использован только для этого HTTP-контракта.

## Доказательства и ограничения

✓ Cache EXPECTED_FAIL: `20261014T155641Z_480561c2` (3/10); header EXPECTED_FAIL после квалификации harness: `20261014T180612Z_403502da` (32/6). Итог: `20261014T180708Z_25360fe9` — 239 PASS / 0 FAIL; `20261014T180708Z_d12e9228` — typecheck exit0. Полные state/stdout сохраняются в `logs/cmd_runner/<run>/` и архиве опыта.

Source/live receipts: `experiments/2026-10-14_go-zen-repair/*.source-wire.json`; исходный HTTP matrix: `experiments/2026-10-14_prompt-cache-options-2026-10-14T15-33-29-937Z/`. Архив: [go-zen-request-repair](../experiments_history/2026-10-14_go-zen-request-repair/REPORT.md).

✓ Полный compiled кандидат10.0.1342 в изолированном каталоге получил `OK` и step-finish stop через Zen/Muse (`20261014T181257Z_8201227a`) и Go/GLM-5.3-Flash (`20261014T181445Z_d5e194da`), оба exit0. Отдельные SDK probes Muse вернули403 с UA opencode/local; это другой слой, отрицательные результаты сохранены. Работа полного кандидата подтверждена, причинный эффект одних заголовков не заявлен.

✓ Полный `accounts/fireworks/models/glm-5p3-flash` через Go с session header получил HTTP400 `Model is unavailable`. Fireworks Flash через Go и фактическая длительность кеша не квалифицированы; живой `bin/` не обновлён.

Keep-warm остаётся гипотезой: HTTP/TCP ping не прогревает префикс модели. Возможный опыт — тот же префикс с минимальной генерацией раз в 20 минут при простое, с отдельным контролем без прогрева и проверкой `cached_tokens` после исходного срока. Расход квоты, обновление TTL и гарантия маршрута должны быть измерены до внедрения. [Fireworks prompt caching](https://docs.fireworks.ai/guides/prompt-caching) описывает exact-prefix reuse и replica affinity; гарантии продления срока таким запросом здесь не установлены.
