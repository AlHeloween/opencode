# KAT/StreamLake preserve_thinking — маркер (чтобы не изучать с нуля)

> Статус: **ПОД ВОПРОСОМ** (закоммичено как версия, вердикт не подтверждён)
> План: `plans/2026-08-16-kat-preserve-thinking-questionable.md`
> Коммит: `cd9688f726` — `fix(provider): preserve_thinking passthrough for KAT/StreamLake gateways (EXPERIMENTAL — под вопросом)`

## В чём вопрос (кратко)

При редактировании тулов на KAT/StreamLake-гейтвеях (KAT-Coder-V2.5, URL `streamlake|vanchin`)
ломается prefix-cache: interleaved chat-template без `preserve_thinking` ломает matching,
когда tool-call сообщения попадают в replay → `cached_tokens` падает в 0 на первом же
write/edit-ходе (полный re-prefill 60K+). Вендор-карточка KAT документирует
`preserve_thinking` как улучшение KV-cache утилизации в агентных сценариях.

Правка: `packages/opencode/src/provider/transform.ts` → `providerOptions()` подмешивает
`chat_template_kwargs: { preserve_thinking: true }` в тело запроса для KAT-гейтвеев
(passthrough через copilot-совместимый провайдер).

## Python-эксперименты (LOCAL-ONLY, не в git)

⚠️ Вся папка `experiments/` в **.gitignore** (строка 66: `experiments/`) — скрипты не
попадают в git, а дефолтные поиски (glob/grep/list) их не видят. Искать их нужно с
`noIgnore: true` или напрямую по пути:

**`experiments/cache-alignment-smoke/`** — живая лаборатория KAT-кеша:

| Скрипт | Что проверяет |
|---|---|
| `smoke_kat_cache_preserve.py` | **V6, ключевой**: no-echo + `chat_template_kwargs.preserve_thinking=true` — держит ли кеш через tool-ходы без reasoning-echo |
| `smoke_kat_cache_edit.py` | кеш на write/edit-ходе (симптом коллапса) |
| `smoke_kat_cache_isolate.py` | изоляция причины коллапса |
| `smoke_kat_reasoning_echo.py` | эхо `reasoning_content` и его влияние |
| `smoke_kat_reasoning_toolcall.py` | reasoning-эхо при tool-calls |
| `smoke_interleaved.py` | interleaved chat-template |
| `smoke_gapfill_parity.py` | gap-fill retry кеш-паритет (0.990 M-префикс HIT, из `_progress_log.md`) |
| `smoke_guard.py`, `smoke_max_tokens.py`, `smoke_prefix_shrink.py`, `smoke_sidecar.py` | прочие гварды/бюджеты |

Общие параметры (из `smoke_kat_cache_preserve.py`):
- `BASE_URL = https://vanchin.streamlake.ai/api/gateway/coding/v1`
- `MODEL = ep-kneqk9-1786632248553436783` (pasha-coder)
- ключ: `bin/auth.json` → `["pasha-coder"]["key"]`
- фикстура: SYSTEM с повторами «Rule N» (псевдо-токены) + 1 tool `write_file` + сценарий
  из 6 сообщений (обычный ход → tool create/edit → confirm) с `prompt_cache_key`-бакетами.

## Что уже известно (не переоткрывать)

- Симптом: `cached_tokens = 0` именно на write/edit-ходах (tool-call replay), не на обычных.
- Механизм: interleaved template + tool-calls в replay → префикс не совпадает.
- Фикс-кандидат: `preserve_thinking` в `chat_template_kwargs` (валидирован live один раз).
- Флаг уходит в JSON body verbatim (в options-схеме поля нет).

## Открытые вопросы (из плана)

- Q1: валиден ли флаг для ВСЕГО гейтвея (URL-regex широкий — может задеть другие модели)?
- Q2: связаны ли pre-existing провалы `prompt.test.ts` (40 fail на HEAD) с этой правкой?
- Q3: воспроизводится ли коллапс кеша без флага на втором независимом прогоне?

## Как повторить живой smoke (P2 из плана)

1. Прогнать `experiments/cache-alignment-smoke/smoke_kat_cache_preserve.py` (V6, с флагом)
   и контрольный вариант без `chat_template_kwargs` (строка 57-58 скрипта).
2. Сравнить usage по бакетам: падение `cached_tokens` в 0 на tool-ходе = воспроизведённый коллапс.
3. Результаты → `_progress_log.md` + вердикт в план (оставить/откатить/сузить условие).
