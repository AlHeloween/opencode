<!-- intention: выбор фразы часто не откатывает сессию -> причины различены изолированным runtime-примером idle/busy и результат вынесен на обсуждение без исправления продукта -->
<!-- goal_sv: { keywords: { undo-runtime: 0.4, isolation: 0.25, ui-request: 0.2, evidence: 0.15 }, dominant: Изолированное воспроизведение отказов Revert до решения о ремонте. } -->
# Изолированное воспроизведение Revert

Состояние: COMPLETED — исследовательское воспроизведение, без исправления продукта. Авторизация: владелец «Ага, давай» после предложения изолированной проверки idle/busy с фиксацией запроса, ответа и сохранённого состояния. Продуктовые исправления не входят.

```yaml
Keywords: undo-runtime 0.40, isolation 0.25, ui-request 0.20, evidence 0.15
Semantic dominant: Изолированный стенд различает отказ сервера и отсутствие запроса при выборе фразы.
md5: e7316a9d20c74b1a8e05f2c963bd470a
prev-md5: 00000000000000000000000000000000
parent-goal-md5: d87ab3924c6f40a19e520bd7638f15ce
```

## Контракт

✓ CONFIRMED (текущий git status): Local_Development, есть чужие dirty-изменения; они сохраняются. ✓ CONFIRMED (предыдущие source pins, перепроверяются перед запуском): DialogMessage, SessionRevert, SessionRunState, Runner и Fossil дают конкретные поверхности. Их механизм Inferred; причина жалобы до runtime Unknown.

PLAN_STRATEGY: поддерживает master-goal mechanical continuity/proof-not-claim; результатом является измеренный разрыв, не внедрение исправления. Структурные источники: mounted CodeGraph и owning tests test/server/httpapi-bridge.test.ts, test/fixture/fixture.ts, test/session/revert-user-anchor.test.ts.

EXECUTION_ENVELOPE: READ проекта; MODIFY_CANDIDATE только experiments/2026-10-14_session-undo-investigation и автоматически создаваемые изолированные fixture-каталоги под .temp/test; PLAN_WRITE только этот план, его завершённая версия и одна запись _progress_log; штатный svm render сохраняет чужую ручную часть MASTER_PLAN; обязательный _build.ps1 пишет candidate dist/.temp и собственные generated build outputs. Не редактировать продукт, bin, live DB, live Fossil и существующие сессии; исследовательская сессия Смита разрешена. Loop=3, steps=60, tools=90, depth=1, time_ms=1800000. Никаких новых платных моделей/сетевых исследований; робот Zen Muse, резерв Go GLM по указанию владельца. Локальные HTTP запросы только отдельному стенду; сервер завершается в finally, процессы через cmd_runner с timeout. Проектные смоки только из packages/opencode с явным путём. Полного bun test нет.

## Smoke Tests

Перед запуском: известный fixture контроль (порт=0, GET известного файла или session.get, отдельные paths), точный ID и тексты sentinel подтверждаются чтением back; runner известен по собственному сигналу входа и assertNotBusy, не по задержке. Предсказания:

- idle, корректная точка: revert.messageID=target; содержимое sentinel=baseline; redo возвращает after.
- busy, прямой Revert: отклонён; состояние revert отсутствует; sentinel=after.
- busy, cancel затем Revert: runner становится idle; корректная точка и baseline восстановлены.
- idle, отсутствующая точка: HTTP 200 с неизменённым revert (ожидаемый no-op, не успех продукта).
- выбранная фраза другой сессии: проверить факт отправки запроса и пару sessionID/messageID; отсутствие запроса отличается от успешного HTTP.

Непредсказанный результат сначала HARNESS/SPEC/IMPLEMENTATION классификация, не автоматический PASS. Оракулы — readback session+файл+wire+видимый TUI где есть настоящий renderer. Источник handler не копировать вместо реального исполнения. Не называть HTTP/API-only прогон визуальным E2E.

## Задачи

- [x] R1. Квалифицировать и подготовить изолированный harness реальных Session/Runner/Fossil/HTTP. ✓ CONFIRMED: runner fixture 0e1c0990, реальный Fossil baseline 40971829 (1 pass), renderer/key fixture 8d078427 (1 pass), полный HTTP/SQLite/Fossil прогон 299b70bf (26 assertions). <!-- sv: { keywords: { isolation: 0.5, real-services: 0.5 }, dominant: Стенд использует реальные сервисы и отдельное состояние. } -->
- [x] R2. Выполнить матрицу idle/busy с readback и отдельно проверить выбранную фразу. ✓ CONFIRMED: 20261014T041652Z_802ead1e, exit0, 1 pass/0 fail, 43 assertions; real DialogMessage + genuine contexts + native render, wire и SQLite/file readback. Busy=500/меню закрыто/нет уведомления; idle valid=200/target+BEFORE; missing=200/no revert/AFTER; неверный owner=нет запроса/меню осталось. <!-- sv: { keywords: { undo-runtime: 0.6, ui-request: 0.4 }, dominant: Каждый исход различён запросом и состоянием. } -->
- [x] R3. Независимо прочитать полные логи, записать ограничения, выполнить обязательный build и закрыть исследовательский план. ✓ CONFIRMED: build 20261014T041736Z_c8e6fb5e exit0, bytes_dropped0/truncated=false, candidate только dist; отчёт и полные логи experiments_history/2026-10-14_undo-runtime-reproduction, неудачные harness-прогоны сохранены. <!-- sv: { keywords: { evidence: 0.6, closure: 0.4 }, dominant: Закрытие только по измеренным исходам. } -->

## Риски и rollback

RISK live-tree restore: исключён отдельным fixture и проверкой пути перед write/checkout. RISK общие portable globals: отдельный процесс и последовательные кейсы, dispose. RISK зависшая сессия: signal-start + bounded wait и stop/finally. RISK инструмент подменяет продукт: реальные imports/HTTP; UI-only вывод без renderer остаётся residual. Rollback инструмента: не устанавливается; исходники не меняются. Первичный анализ experiments/2026-10-14_session-undo-investigation/analysis.md — handle, не runtime stamp.

## Измеренная граница

✓ CONFIRMED: busy формируется реальным SessionRunState.ensureRunning с сигналом входа, без реального LLM-запроса; idle — persisted завершённый ответ. Исполнен настоящий DialogMessage, не весь Session route. Неверный owner подан как известный fixture-вход диалога; переход в composite/AGI через весь интерфейс не воспроизведён. `/undo` проверен по его server-последовательности abort→revert, а не через slash-парсер. Случай владельца в его сессии не повторялся, причины его конкретного отказа остаются residual. Это проверка механизма, а не исправление и не подтверждение частоты.

✓ CONFIRMED (полный build log, 633 строки): обязательная сборка завершилась, но Novita provider-sync сообщил timeout и использовал registry fallback. Также есть предупреждения Rust syn0.11.11, метаданных WASM и Vite chunk/import. Они сохранены отдельно от результатов undo; свежий Novita-каталог этим build не подтверждён.

IMPLEMENTATION_RESULT: actual_diff продукта=none; добавлены только исследовательский стенд/доказательства, план и запись progress. ISSUE_KEY=(выбор фразы, DialogMessage, isolated idle/busy); status=reproduced, stop_reason=запрошенное исследование выполнено, failed_approaches=логи harness, reopen_when=авторизация ремонта или новый различающий live-сценарий. Residual: точный случай владельца; полномасштабный Session/composite route; drift/compact-crossing вне этого стенда. Route=обсуждение измеренных веток и отдельный план ремонта.

✓ CONFIRMED (R5 read-only audit и родительское чтение tap): в wrong-owner фиксируется отсутствие именно `/revert`/`abort`, не любых сетевых операций. Слова «не отправляет запрос» выше ограничены запросом отката. R5 не перечитывал run state/logs; их целиком проверил родитель. Source pins, manifest readback и scope diff закрываются родителем, согласие робота само по себе не oracle.
