# Plan: KAT/StreamLake `preserve_thinking` passthrough — ПОД ВОПРОСОМ

- plan_id: b4e7d1a9-2c5f-4a8e-9b3d-7e6f5d4c3b2a
- revision: 1
- created_by: build_mode
- state: **COMMITTED-UNDER-QUESTION** (2026-08-16: правка закоммичена как версия по решению пользователя, НО вердикт финально не подтверждён — Q1–Q3 остаются открытыми; возможен откат отдельным коммитом)
- date: 2026-08-16

## Status: ПОД ВОПРОСОМ

Правка в `packages/opencode/src/provider/transform.ts` (`providerOptions()`) появилась как
живой эксперимент утром 2026-08-16 (smoke `smoke_kat_cache_preserve.py`). **Закоммичена как
версия 2026-08-16 по явному решению пользователя, с пометкой в commit message — ПОД
ВОПРОСОМ.** Open questions (Q1–Q3) не закрыты: при опровержении — revert отдельным коммитом.

## Причина правки

При редактировании тулов кеш ломается: на KAT/StreamLake-гейтвеях (KAT-Coder-V2.5,
URL `streamlake|vanchin`) interleaved chat-template без `preserve_thinking` ломает
prefix-cache matching, когда в replay попадают tool-call сообщения → `cached_tokens`
падает в 0 на первом же write/edit-ходе (полный re-prefill 60K+). Вендор-карточка
документирует `preserve_thinking` как улучшение KV-cache утилизации в агентных сценариях.

## Текущая правка (uncommitted)

```ts
// providerOptions() в transform.ts (~1213):
const isKatGateway =
  /streamlake|vanchin/i.test(model.api.url ?? "") &&
  (model.api.npm === "@ai-sdk/github-copilot" || model.api.npm === "@ai-sdk/openai-compatible")
return {
  [key]: {
    ...normalized,
    ...(isKatGateway ? { chat_template_kwargs: { preserve_thinking: true } } : {}),
  },
}
```

Флаг уходит в тело запроса через passthrough copilot-совместимого провайдера
(`chat_template_kwargs` отсутствует в его options-схеме → spread в JSON body verbatim).

## Open questions (что под вопросом)

- Q1: реально ли `preserve_thinking` в теле запроса валиден для KAT API и не отвалится на других моделях того же гейтвея?
- Q2: не связаны ли pre-existing провалы `prompt.test.ts` (40 fail на HEAD) с этой правкой (providerOptions участвует в тестовых запросах)?
- Q3: воспроизводится ли коллапс кеша без флага на втором независимом прогоне (не разовый сбой)?

## Tasks

| Task | Что | Oracle |
|---|---|---|
| P1 | Проверить `prompt.test.ts` на HEAD без этой правки vs с ней — изолировать влияние (stash/apply патч-файлом) | сравнение fail-наборов |
| P2 | Повторный живой smoke на KAT: с флагом и без — `cached_tokens` на write/edit-ходах | `smoke_kat_cache_preserve.py`-стиль: gateway usage в 2 прогонах |
| P3 | Решение: коммит `fix(provider): ...` / откат / доработка (напр., только для конкретной модели, не по URL-regex) | Q1–Q2 закрыты |
| P4 | Если коммит: отдельный commit от компакт-фикса; обновить план/логи | — |

## Smoke Tests (PRE_FLIGHT)

- baseline: `cmd_runner start --cwd packages/opencode -- bun typecheck` → exit 0.
- baseline: `cmd_runner start --cwd packages/opencode -- bun test test/session/prompt.test.ts` — зафиксировать текущий fail-набор как эталон «с правкой».

## Outcome contract

- OC1: Q1–Q3 отвечены данными (не предположениями).
- OC2: правка либо закоммичена отдельным коммитом с обоснованием, либо откачена — дерево чистое.
- coverage_threshold: 1.0.

## Risks

- R1: правка без ответа на Q1 может сломать другие модели на KAT-гейтвее (широкий URL-regex).
- R2: правка в дереве может случайно попасть в чужой коммит — не коммитить в составе других задач.
- R3: pre-existing провалы prompt.test.ts могут маскировать эффект флага.
