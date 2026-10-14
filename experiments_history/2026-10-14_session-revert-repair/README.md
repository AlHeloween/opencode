# Подтверждённый TUI Revert — доказательства ремонта

```yaml
Keywords: session-revert 0.45, runtime-evidence 0.35, retained-failures 0.20
Semantic dominant: Реальные wire, SQLite, файл и TUI различают успешный откат и отказ.
md5: 92867d5c08c749d0b8f3ca6241a957eb
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 3816ecdf327f41ba92d867a40b53f109
```

План: [2026-10-14_session-revert-repair](../../plans_completed/2026-10-14_session-revert-repair.md).
Предшествующее воспроизведение: commit `7fc9765093` и соседний архив `2026-10-14_undo-runtime-reproduction`.

✓ CONFIRMED (полные логи + state.json):

| Прогон | Результат |
|---|---|
| 20261014T064615Z_442b382c, baseline | SU-1: 1 pass, 0 fail |
| 20261014T065309Z_6d3fab4a, before | 1 fail на busy: expected200, actual500; 21 assertions; прежний код |
| 20261014T065636Z_ec3e4f93, after | 6 pass, 1 fail; HARNESS ожидал новую identity toast proxy |
| 20261014T065839Z_1440bfea, format | exit0, форматирование пяти изменённых файлов |
| 20261014T065908Z_364d2130, after-qualified | 7 pass, 0 fail; 79 assertions |
| 20261014T065908Z_8791e13b, regression | 14 pass, 0 fail; 67 assertions; три именованных файла |
| 20261014T065636Z_d9231e4a, typecheck | bun run typecheck, exit0 |
| 20261014T070107Z_bd75f1a7, build | _build.ps1, exit0; candidate dist/ |

Все завершённые runner state: `bytes_dropped=0`, `truncated=false`. ConPTY build учёл 51737 capture bytes; ANSI-stripped `stdout_text.log` содержит 50735 bytes, 666 строк. Это разные представления одного вывода, не потеря данных. Логи хранятся полностью в `evidence/`; SHA256 в manifest вычислены по фактически сохранённым bytes.

✓ CONFIRMED (`after-qualified/session-revert-evidence.json`): idle и busy записали выбранный `revert.messageID` в SQLite и восстановили `BEFORE\n`; redo вернул `AFTER\n`. Для busy wire содержит завершённый abort200 перед revert200. HTTP500 и HTTP200 без точки показывают видимую ошибку, оставляют меню и ввод. Wrong owner/ghost дают явную ошибку локального поиска, без revert/abort запроса. Wire tap охватывает только abort/revert/unrevert; это не утверждение об отсутствии любых HTTP-запросов.

✓ CONFIRMED (реальный SDK, `session-revert-request.test.ts` и лог after-qualified): error на abort исключает последующий revert; error на revert, отсутствие точки, чужая точка и чужая сессия отклоняются. В успешном случае проверены оба ID и тело запроса. Это контролируемый локальный HTTP fixture, не отказ реального сервера при отмене.

✓ CONFIRMED (toast qualification и native frames): TOAST_A→TOAST_B изменяет поля существующего Solid proxy (`stableReference=true`). Поэтому первый post-run был ошибкой наблюдения в тесте. Исправлен инструмент: каждый error-кейс начинается с известного info-toast и проверяет значения/кадр, а не object identity. Неудачный прогон сохранён. Исторические файлы предыдущего исследования не переписаны.

Граница: реальный DialogMessage, настоящие providers/native renderer, SDK/HTTP, Session/Runner/Fossil и отдельная SQLite; busy создан deterministic ensureRunning, без LLM-вызова. Это не весь App/Session route, не slash-parser и не сквозной composite/AGI клик. Canonical `message.sessionID` и использование общего helper обоими handlers проверены текущим исходником (Inferred). Конкретный случай владельца и частота сбоев не измерены. Live DB, живые сессии и bin/ не откатывались и не менялись.

Аудит Смита: прочитанный product diff без обнаруженных дефектов. Его «нет abort-failure oracle» не принято: он не прочитал отдельный request.test, а родитель запустил и проверил этот сценарий. ToastProvider — штатная зависимость обоих продуктовых входов. Потенциальное маскирование первичного assertion при редком cleanup-failure остаётся ограничением тестового harness; в измеренных прогонах cleanup завершился. Полный аудит чужих активных планов не выполнен и здесь не объявляется PASS.

Сборка сохранила предупреждения Rust syn0.11.11 и Vite mixed static/dynamic imports + chunk >500 kB. Undo-регрессии прошли независимо от этих сообщений. Установка кандидата в живой runtime в работу не входит.

Инструменты: CodeGraph дал callers/impact, вложенные обработчики потребовали прямого reread опущенных диапазонов; edit Смита отказался писать по устаревшему fromHash — guard сработал. Native renderer/SDK/SQLite/Fossil и cmd_runner ответили; неверный toast predicate исправлен и квалифицирован. Общий archive.cjs сканирует весь experiments/ без scope-аргумента, поэтому не запускался на чужих материалах: сюда отобраны только логи и synthetic fixture data этого запуска, после content check. Briefs/robot session identifiers и разговоры не копировались.

Повторение из `packages/opencode`: `bun test test/cli/tui/session-revert.test.ts test/cli/tui/session-revert-request.test.ts`, затем `bun test test/session/session-undo-fossil.test.ts test/session/revert-user-anchor.test.ts test/cli/tui/revert-diff.test.ts` и `bun run typecheck`; после тестов обязателен корневой `_build.ps1`. Для JSON/readback задать `UNDO_REPAIR_EVIDENCE` на scratch-папку в experiments/, не на этот архив. `manifest.json` закрепляет финальные source hashes и архивные blobs; live database в архив не включена.
