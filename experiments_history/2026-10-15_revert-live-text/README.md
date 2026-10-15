# Невидимый текст после выбранного Revert

План: `plans_completed/2026-10-15_revert-live-text.md`.

## Подтверждённая причина

После настоящего Revert и следующего `SessionRevert.cleanup` серверная сессия
больше не содержит revert. `server/projectors.ts` превращает persisted patch
в полный snapshot через `Session.fromRow`. JSON-сериализация исключает
`revert: undefined`, а прежний `Object.assign` в SyncProvider оставлял старый
курсор. Второй Match в JSX (`id >= revert.messageID`) затем скрывал новый ход,
хотя `messagesList/revertedRun` уже пропускал его и текст был в store.

Исходный native кадр пуст; после A→B→A виден тот же `LIVE_AFTER_REVERT`.
`before-fix-qualified-frames-wire-store.json` разделяет wire, server/client
revert, текстовую часть и кадры. В `before-fix-qualified.log` решающий fail:
ожидался видимый новый текст до навигации, получено false.

## Изменение

Полный snapshot с `info.id === sessionID` применяется через `reconcile`.
Прямой partial без id продолжает merge. Второй Match удалён; отбор сообщений
отката сосредоточен в `messagesList/revertedRun`.

## Оракул

`native-final.log`: 1 pass, 15 assertions; полный Session, выбранный Revert
через настоящий DialogMessage/SDK/HTTP/Fossil, следующий ответ до навигации,
дельта, повторный откат/ответ, соседняя сессия, partial cost patch и full
snapshot, отдельная инъекция obsolete cursor с отсутствующим якорем.
Финальные кадры и состояния: `final-native-qualified-frames-wire-store.json`.
`existing-tui-final.log`: 7 pass, 79 assertions.
`fossil-final.log`: 14 pass, 67 assertions. `typecheck-final.log`: exit 0.
`build-final.log`: `_build.ps1` exit 0, candidate 10.0.1351 в dist,
version/embedded-prompt smoke успешен. Rust `syn v0.11.11` warning и
диагностика Vite сохранены в полном логе.
Состояния cmd_runner сохранены целиком, dropped=0, truncated=false.

## Сохранённые неудачи и исправления стенда

- `invalid-fixture-api`: ранний запуск с неверным именем метода fixture;
  исправлен вызов реального DialogMessage. Это не воспроизведение продукта.
- `invalid-typecheck`: лишняя вложенность Promise в типе server.fetch;
  исправлен async/await handler.
- `regression-timeouts`: два реальных Fossil-теста превысили default 5 s;
  добавлен file-level timeout 20 s, assertions не изменены. Финальный прогон зелёный.
- `intermediate-teardown`: продуктовый тест зелёный, teardown отменял
  незавершённую загрузку route; стенд теперь ждёт завершения HTTP-запросов.
- R1 робота пропустил второй Match и ошибочно исключил stale revert;
  независимый native оракул опроверг вывод. Review — свидетельство чтения,
  его недостающие delta/repeat/neighbor/partial проверки затем добавлены.

## Граница

Настоящие Session, Fossil, SDK/HTTP и native Session renderer; Bus-события
проходят JSON. Provider/LLM не запускается: ответы и cleanup вызываются
детерминированно. Фактический SSE-транспорт, весь App, composite/AGI и живая
сессия владельца не квалифицированы этим тестом. Изменение состояния владельца,
промоушен в `bin/` и push не выполнялись.

`manifest.json` содержит SHA256 точных evidence-файлов и пяти проверенных
исходников. Локальный `-text -whitespace` сохраняет терминальные байты без
нормализации и ложных замечаний к сырым CRLF-логам.
