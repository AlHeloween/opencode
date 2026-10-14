# Revert: изолированное runtime-воспроизведение

```yaml
Keywords: dialog-revert 0.40, isolated-runtime 0.30, wire-readback 0.20, limits 0.10
Semantic dominant: Настоящий DialogMessage воспроизводит тихий отказ при busy и отсутствие запроса при неверном владельце сообщения.
md5: c915fa307de64b92a083f15e6d70bc24
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e7316a9d20c74b1a8e05f2c963bd470a
```

✓ CONFIRMED (полные state/stdout, wire JSON, SQLite и файловый readback): `ui-pass` / `20261014T041652Z_802ead1e` — exit0, 1 pass, 0 fail, 43 assertions. Перед ним контроль настоящего Fossil `baseline` — 1 pass; fixture Enter/frame/alias `ui-qualification-pass` — 1 pass. Источник — рабочий код репозитория, без продуктовых изменений, mock.module и копии обработчика. HTTP — loopback с port0, экземпляр — отдельный .temp/test/opencode-test-*; конфиг/ключи владельца не используются. Credential env удалён в payload; в логах только имена удалённых переменных.

## Наблюдения

| Сценарий | Wire | Readback | Видимое поведение настоящего DialogMessage |
|---|---|---|---|
| idle, существующая фраза | ✓ 200, нужный messageID | ✓ session.revert.messageID=target в HTTP и SQLite; файл BEFORE | ✓ меню закрыто, setPrompt вызван |
| busy, та же фраза | ✓ 500 | ✓ revert=null в SQLite; файл AFTER | ✓ меню закрыто, setPrompt тоже вызван; кадр без уведомления об ошибке |
| cancel активного runner, затем revert | ✓ abort200 → revert200 | ✓ нужная точка и файл BEFORE | slash-команда `/undo` целиком не нажималась |
| idle, отсутствующий messageID | ✓ 200 | ✓ revert=null, файл AFTER | проверено API; это успешный transport при no-op |
| неверная сессия для выбранной фразы | ✓ запрос /revert отсутствует | после этого шага файл отдельно не перечитывался | ✓ Revert нажата настоящим Enter; меню осталось, ошибки нет |

Граница wire-tap: он записывает `/revert` и `/abort`. Поэтому `noRequest:true` в JSON означает отсутствие этих запросов, а не доказательство отсутствия любых HTTP-методов, включая DELETE. R5 заметил эту щель; широкая формулировка «вообще ничего не ушло» не используется. Это не whole-network oracle. Адаптер `events` в renderer подписывается на реальный `Bus.subscribeAll`, не подменяет ответы SDK.

Полные 100×30 native-кадры до/после и row session из SQLite находятся в `http-replay.json`; запросы/ответы — `wire-replay.json`. Все сообщения и имена файлов синтетические. В файлах сохранены адреса уже удалённого fixture: его состояние считано до disposal, не предлагается читать отсутствующий каталог как свидетельство.

## Граница вывода

✓ CONFIRMED: busy — настоящий runner с ожиданием promise и сигналом входа; реальный платный/сетевой LLM не запускался. Завершённый ответ seeded через реальный Session service. `DialogMessage`, его контексты, клавиатура и renderer настоящие; whole-App/Session route не монтировался. Composite-mismatch воспроизведён на входе диалога; фактическая передача неправильного owner из composite остаётся Inferred по `index.tsx:1835`. Полный `/undo` и конкретная сессия владельца не воспроизводились. Drift, compact-crossing и invalid Fossil hash в этом стенде не инъецировались. Исправлений нет.

Следующий ограниченный шаг по результатам обсуждения: общий ожидающий обработчик Revert и `/undo`, явные ошибки и проверка достигнутого messageID, правильный sessionID составной истории. Это предложение, не сделанная работа.

## Инструменты и сохранённые неудачи

✓ CONFIRMED (соответствующие полные логи): первые прогоны выявили ошибки нового harness: Service ошибочно передан напрямую в runPromise; SnapshotFossil.Service отсутствует (правильно Snapshot.Service); experiments не наследовал aliases OpenTUI; внутренняя функция pressReturn экспортируется как pressEnter; native Hono endpoints требуют Instance.provide вокруг сетевого fetch. Исправления внесены только в стенд. Failed-прогоны не являются тестовыми результатами продукта и не отбрасываются.

Alias квалификация теперь отдельный `module-qualification.test.ts`; tsconfig наследует канон пакета. Промежуточная junction не решила aliases и не является требуемой настройкой; она не архивируется. Источники располагаются на той же глубине от корня, поэтому относительные imports сохраняются после архивации.

## Повтор

Из `packages/opencode`, через cmd_runner: `bun test ../../experiments_history/2026-10-14_undo-runtime-reproduction/module-qualification.test.ts`, затем `UNDO_UI_PROBE=1 bun test ../../experiments_history/2026-10-14_undo-runtime-reproduction/replay.test.ts`. На Windows штатный `payload.py qualify-ui`/`payload.py ui` удаляет credential env и выбирает обнаруженный на этом хосте Bun. Пути в payload — host binding, при переносе их открыть и проверить. После тестов обязателен `_build.ps1` по правилам репозитория.

## Свежесть

Продуктовые файлы не изменялись. Runtime-verdict относится к исходникам текущего Local_Development до каких-либо исправлений; source pins и хеши архивных файлов перечисляются в `manifest.json`. Логи всех попыток читаются целиком, `bytes_dropped=0`, `truncated=false` проверяются по каждому state.

✓ CONFIRMED (build.state.json/build.stdout.log): `_build.ps1` после всех тестов — exit0, candidate dist, .temp/test очищен. В 633 строках build-лога сохранены и предупреждения: Novita sync timeout с registry fallback; Rust syn0.11.11 future compatibility, WASM package metadata, Vite mixed static/dynamic import и размер chunks. Свежесть Novita этим запуском не установлена; эти сигналы не отбрасываются и не подменяют результаты теста undo.
