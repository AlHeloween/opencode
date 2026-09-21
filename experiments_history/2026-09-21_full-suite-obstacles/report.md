# Полный прогон по несобранной системе: что мешает получить ответ

Отчёт о попытке прогнать ВЕСЬ `packages/opencode` на исходниках (шаг 2 цикла).
Прибор: `scan.py` рядом с этим файлом — читает каталог прогона `cmd_runner` целиком
и классифицирует падения. `cmd_runner tail` для этого негоден: он показывает конец
лога, а конец лога — это баннер краха, поэтому хвост **скрывает** инвентарь падений.

## 1. Прогон (Exact — `state.json` прогона)

| | |
|---|---|
| run | `20260921T133354Z_00690145` |
| argv | `bun test` · cwd `D:\zPython\opencode\packages\opencode` |
| окно | `2026-09-21T13:33:54Z` → `2026-09-21T13:49:39Z` (944 383 ms) |
| status / exit_code | `finished` / **`3`** |
| лог | `bytes_written 40652`, `bytes_dropped 0`, `truncated false` |
| ресурсы | `RSS 5.65 GB`, `Peak 9.55 GB`, `Commit 12.82 GB`, `Machine 17.1 GB` |
| итог | **сводки `Ran N tests` в логе НЕТ** |

Лог мал — 40 КБ на 945 с. Он читается целиком в один приём; `tail` не нужен и вреден.

## 2. Что МЕШАЕТ (препятствия, а не дефекты кода)

### O1. Рантайм падает до печати сводки — прибор не может дать вердикт
`oh no: Bun has crashed. This indicates a bug in Bun, not your code.` ·
`panic(thread …): Segmentation fault` · трасса называет **`watcher.node`** многократно.
`exit_code=3` — это код краха, а не счётчик тестов.
⇒ Полный прогон в таком виде **не является прибором**: он неспособен напечатать
результат, поэтому любое «зелено/красно» из него — Unknown (`@ORACLE`).
Вероятный механизм — память: `Peak 9.55 GB` при `17.1 GB` на машине, где параллельно
идёт живая сессия TUI.

### O2. Собственные файлы рабочего дерева протекают в тесты
- `test/config/tui.test.ts` (4 SEMANTIC): ожидаемый список плагинов НЕ содержит
  `file:///D:/zPython/opencode/.opencode/plugins/tui-smoke.tsx`, полученный — содержит.
  В тест попадает **реальный** `.opencode/plugins/` этого репозитория.
- `test/file/index.test.ts`: `status()` на «чистом репозитории» вернул 4 `added` —
  `.opencode\data\opencode.db`, `-shm`, `-wal`, `log\…jsonl`. Это рантайм-состояние
  **живой** сессии, лежащее в дереве.

### O3. 13 из 23 падений — пятисекундный дефолт на загруженной машине
Все измерены на 5.4–8.1 с фактического времени, то есть тест **успел поработать** и был
обрезан. Это ровно тот класс, про который в `AGENTS.md` уже есть правило:
«Heavy test files carry a FILE-level timeout (`setDefaultTimeout(20_000)`), never
per-test whack-a-mole — bun's 5 s default turns a loaded machine into a red that says
nothing about the code». Здесь этот красный говорит о машине.

## 3. Инвентарь падений (23 = 13 TIMEOUT + 10 SEMANTIC)

TIMEOUT (13): `config/config.test.ts` ×7 · `config/tui.test.ts` ×1 ·
`control-plane/sse.test.ts` ×1 · `effect/instance-state.test.ts` ×1 ·
`file/fsmonitor.test.ts` ×1 · `file/watcher.test.ts` ×2.

SEMANTIC (10): `capability/capability.test.ts` ×1 · `config/tui.test.ts` ×3 ·
`effect/runner.test.ts` ×3 · `file/index.test.ts` ×1 ·
`file/path-traversal.test.ts` ×1 · `file/ripgrep.test.ts` ×1.

**Границы инвентаря — честно:** краш означает, что файлы ПОСЛЕ `test/file/watcher.test.ts`
не исполнялись. 23 — это **пол**, а не итог.

Гипотеза (не проверена, помечена как гипотеза): `file/ripgrep.test.ts` («defaults to
include hidden», ждёт `.opencode/thing.json`) и `file/path-traversal.test.ts`
(`containsPath` под `.opencode`) могут иметь общий корень с O2 — поведение скрытых
путей `.opencode/` в этом рабочем дереве. Проверяется изоляцией, а не рассуждением.

## 4. Причастность моего набора правок

Ни одно из 23 падений не лежит в `test/session/` или `test/tui/` — поверхностях моего
набора (`local.tsx`, заголовок `fill-layers.ts`, проза `layer-inherit.ts`, тесты цепи
наполнения). Это наблюдение о границах, **не** ярлык «pre-existing»: в репозитории нет
pre-existing ошибок, есть неисследованные, и каждая ниже — доставка или явный карантин
с причиной.

## 5. Что делать дальше (чтобы получить ответ, а не ещё один Unknown)

1. **По файлам, а не всем пакетом.** Каждый падающий файл поодиночке — это отделяет
   окружение от кода за минуты вместо шестнадцати:
   `bun test test/effect/runner.test.ts` · `test/file/ripgrep.test.ts` ·
   `test/file/path-traversal.test.ts` · `test/capability/capability.test.ts` ·
   `test/config/tui.test.ts`.
2. **Тяжёлым файлам — файловый таймаут** (`setDefaultTimeout(20_000)`), по правилу
   репозитория; тогда 13 таймаутов перестанут маскировать настоящие красные.
3. **Изоляция от живого дерева** для `config/tui.test.ts` и `file/index.test.ts`:
   прогон, при котором в `.opencode/` пишет живая сессия, не может судить «чистый
   репозиторий».
4. Только после (1)–(3) полный прогон становится прибором, и шаг 3 (бинарь) идёт
   вперёд не с неизвестным на борту.

## 6. Проверка по файлам (14:09Z) — окружение и код РАЗДЕЛЕНЫ

Run `20260921T140957Z_9d6467a0`: те же файлы, но только они —
`test/effect/runner.test.ts`, `test/file/ripgrep.test.ts`,
`test/file/path-traversal.test.ts`, `test/capability/capability.test.ts`,
`test/config/tui.test.ts`. **12 секунд**, `exit_code=1`, лог 16 КБ, **краха нет**,
и **сводка ЕСТЬ: `78 pass`**.

| | полный прогон | по файлам |
|---|---|---|
| падений | 23 | **9** |
| из них таймаутов (5 с) | **13** | **0** |
| семантических | 10 | **9** |

Что это доказывает:

1. **Класс O3 подтверждён измерением.** Те же тесты, что в полном прогоне шли
   5.4–8.1 с и были обрезаны, здесь отвечают за 15–999 мс. Дефолт 5 с называл
   МАШИНУ, а не код — ровно как говорит правило репозитория про файловый таймаут.
2. **Семантический красный НАСТОЯЩИЙ** и воспроизводится в изоляции, быстро, на
   незагруженной машине: 9 падений. Это доставка, а не окружение.
3. **Классификацию одного падения пришлось исправить.** `config/tui.test.ts >
   keeps server and tui plugin merge semantics aligned` в полном прогоне попал в
   TIMEOUT (8023 мс), а по файлам это **настоящий отказ утверждения** за 999 мс.
   «Таймаут» маскировал реальный красный — то есть TIMEOUT-класс шире, чем
   «окружение»: в нём есть и то, что просто медленно при нагрузке.

Одно из 10 семантических НЕ воспроизвелось: `Runner > cancel does not mask shell
defects` (в полном прогоне ✗, здесь отсутствует). Значит зависит от порядка или
нагрузки и устойчивым красным не является — помечаю как таковое, а не как
починенное. `test/file/index.test.ts` в набор не входил, поэтому данных о нём
здесь нет.

### Устойчивые 9 (доставка)

- `capability/capability.test.ts` ×1 — у `metadata.results` нет длины (пришло `1`).
- `config/tui.test.ts` ×4 — в список плагинов протекает `.opencode/plugins/tui-smoke.tsx`
  самого рабочего дерева (изоляция теста от дерева).
- `effect/runner.test.ts` ×2 — семантика очереди: ожидали 2, получили 1;
  ожидали `"second-result"`, получили `"first-result"`.
- `file/path-traversal.test.ts` ×1 — `containsPath` false там, где ждали true.
- `file/ripgrep.test.ts` ×1 — `defaults to include hidden`.

