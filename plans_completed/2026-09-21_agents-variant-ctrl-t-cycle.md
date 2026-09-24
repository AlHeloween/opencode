<!-- intention: "ctrl+t открывает форму и не работает на recents" -> "ctrl+t шагает вариант в строке, форма — только для модели не из recents" -->

# /agents: ctrl+t шагает вариант в строке (включая recents)

**Status:** CLOSED (2026-09-24, moved to `plans_completed/`) — implementation + unit pins LANDED (`nextVariant` at agent-model-cell.ts:120, `setForModel` wired at local.tsx:1256, `variantStep` in dialog-agent.tsx; pin test/tui/agent-model-cell.test.ts:178).
Unit runs on disk: `20260921T052930Z_4277e824` (4 pass / 0 fail, agent-model-cell) and `20260921T065309Z_13c584d0` (16 pass / 0 fail across three TUI files + `tsgo --noEmit`).
Live smoke (ctrl+t on an agent row steps the variant in the footer; on a recents row too; a model NOT in recents still opens the form): owner confirmed live testing on 2026-09-24 (shelf readme); a machine record of that run was not located — this worktree holds no session history for 2026-09-21…24 — so the entry cites the owner's confirmation as its source. Re-run waived per the shelf readme.
**Владелец:** сессия `ses_f3d5f006dffe0015eRg1pBuKA2`

## 1. Требование

«когда я подвожу к надписи и кликаю ctrl-t то вариант модели должен циклироваться для этой записи.
Включая recents. Форма выбора ризонинга должна появляться только если эта модель не в recents.»

## 2. Что сейчас (Exact)

- `dialog-agent.tsx` keybind «Variant» (ctrl+t) всегда открывает `DialogVariant` для подсвеченного
  агента — форма вместо шага. На строках «Recently Used Models» он вообще бессмысленен:
  `option.value` там `__recent__provider/model`, а не имя агента.
- `local.model.variant` умеет `list/selected/current/set/cycle`, но всё это привязано к АГЕНТУ:
  `set(value, agentName?, scope?)` берёт модель через `forAgent(agentName)`, а без имени агента —
  модель ТЕКУЩЕГО агента. Модель-уровневый ключ (`variant[provider/model]`) `set` уже пишет
  вторым ключом (`local.tsx:1232`), но отдельного входа «вариант для модели без агента» нет.

## 3. Решение

1. **Чистый шаг** — `nextVariant(variants, current)` в `agent-model-cell.ts`: без выбора → первый
   вариант, выбран средний → следующий, последний → назад к «default» (undefined), пустой список →
   undefined. Свойство: полный цикл возвращается к исходному за `len+1` шагов.
2. **Запись без агента** — `local.model.variant.setForModel(model, value, scope)` +
   `selectedForModel(model)`: пишут/читают тот же модель-уровневый ключ, что `set` заполняет вторым,
   и сохраняют по тому же правилу слоя (`session` → файл сессии, `worktree` → model.json,
   `global` → отказ с тостом, потому что глобальные записи там поагентные).
3. **Решение «шаг или форма»** — правило владельца: модель в recents → шаг в строке; модель НЕ в
   recents → форма (`DialogVariant`), как сегодня.
4. **Видимость шага** — в футере recents-строки появляется текущий вариант (`→ build_mode · high`),
   иначе шаг на них был бы неотличим от ничего.

## 4. Файлы

- `src/cli/cmd/tui/component/agent-model-cell.ts` — `nextVariant`.
- `src/cli/cmd/tui/context/local.tsx` — `variant.selectedForModel` / `variant.setForModel`.
- `src/cli/cmd/tui/component/dialog-agent.tsx` — поле `variantStep` на опции, обработчик ctrl+t,
  вариант в футере recents.
- `test/tui/agent-model-cell.test.ts` — тесты `nextVariant`.

## 5. Smoke Tests

1. **Baseline:** тесты `nextVariant` — FAIL (функции нет).
2. **Post:** `nextVariant` зелёный; `bun test test/tui/` без регрессий; `bun typecheck` exit 0.
3. **Живьём (после пересборки):** ctrl+t на строке агента меняет вариант в футере, не открывая
   форму (если модель в recents); на строке recents — тоже; для модели не из recents открывается
   форма.
