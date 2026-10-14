<!-- intention: выбор фразы часто не откатывает сессию -> Revert и /undo подтверждают достигнутую точку либо показывают ошибку без ложного восстановления ввода -->
<!-- goal_sv: { keywords: { session-revert: 0.45, result-confirmation: 0.3, regression: 0.25 }, dominant: Проверяемый откат выбранного сообщения в idle и busy сессии. } -->
# Исправление TUI Revert

Состояние: COMPLETED (bounded TUI repair; не глобальный аудит портфеля). Авторизация владельца: «Давай» после предложения ремонта по изолированному воспроизведению. Источник исходного дефекта: commit 7fc9765093, experiments_history/2026-10-14_undo-runtime-reproduction. Это ремонт измеренных TUI-путей, не обещание исправить любую причину жалобы владельца.

```yaml
Keywords: session-revert 0.45, result-confirmation 0.30, regression 0.25
Semantic dominant: Подтверждённый результат отката управляет изменением интерфейса.
md5: 3816ecdf327f41ba92d867a40b53f109
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 5be803d72a1f4c96b807ed2539a6f140
```

## Grounding и стратегия

✓ CONFIRMED (CodeGraph + перечитывание исходников): DialogMessage запускает revert без await; /undo ловит ошибку, но после catch продолжает менять ввод; composite передаёт route.sessionID вместо message.sessionID. Источники: dialog-message.tsx:56, index.tsx:1000 и :1835. Механизм Inferred, поведение busy/idle подтверждено старым runtime-стендом и будет перепроверено новым тестом.

Source pins SHA256 перед изменением: dialog-message.tsx=fedefa5d0bccc1eb80f1e01441e8cf3183a81ed84c065a6f8c8d1754532cf442; index.tsx=f04218efbb867af46cd3411a36386b95d95ff55242bd666f02d0b6b9d297e082; session/revert.ts=06f06a105aa7de12202d363496d245f8f932526b282428f7d383bc05292ecceb. CodeGraph показал callers DialogTimeline и Session; вложенный обработчик /undo опущен индексом, поэтому диапазоны перечитаны напрямую. Новая TUI utility не имеет существующих consumers; два потребителя названы заранее.

PLAN_STRATEGY: поддерживает master goal mechanical-state/proof-not-claim/turn-loop-first: восстановление состояния перестаёт зависеть от оптимистичного поведения меню. Рассмотренные листья: ожидание HTTP, остановка busy, проверка результирующего messageID, владелец composite, регрессия redo. Первые три образуют общий линейный обработчик; owner — отдельная строка связывания; redo — независимый контроль. Ремонт Fossil и изменение серверного API не входят.

## Envelope и binding

ALLOW: READ проекта; PLAN_WRITE этот план, завершённая версия, одна запись _progress_log, штатный svm render; MODIFY_PROJECT только packages/opencode/src/cli/cmd/tui/routes/session/dialog-message.tsx, index.tsx и новая sibling utility session-revert.ts; тесты packages/opencode/test/cli/tui/session-revert*; документация docs/fossil-snapshot.md. MODIFY_CANDIDATE experiments/2026-10-14_session-revert-repair, изолированные .temp/test и обязательная сборка dist/.temp. Разрешена текущая исследовательская сессия Smit через существующий HTTP host, Zen Muse Spark 1.3 Free; при исчерпании лимита Go GLM-5.3-Flash. Чужие dirty-пути не меняются и не коммитятся. bin/ и live undo/DB/Fossil исключены. Без push и установки.

Границы root: steps=70, tools=110, loop=3, depth=1, time_ms=2400000. Робот получает остаточный ограниченный slice; никакого продления бюджетов. Процессы cmd_runner с timeout, локальный fixture-сервер stop в finally. Тесты только из packages/opencode с именованными файлами. Общий build — только _build.ps1 build, не check с полным suite.

## Smoke Tests

Acceptance frame (до правок): A1 idle → выбранный target, SQLite.revert и BEFORE; A2 busy → abort завершён перед revert, target и BEFORE; A3 HTTP error/200 без нужного target → видимая ошибка, прежний ввод, меню остаётся; A4 canonical message.sessionID передаётся для composite; A5 redo возвращает AFTER. Оракул: настоящий DialogMessage/native renderer + реальный SDK/HTTP/Runner/Fossil + чтение SQLite/файла; контролируемые ошибочные HTTP-ответы только для недостижимых детерминированно отказов. Тест utility использует реальный SDK и локальный HTTP сервер, не подменяет SDK.

Прогноз baseline существующего SU-1: PASS. Новый regression до исправления: FAIL на busy/неподтверждённом результате (не на harness/import). После исправления: PASS A1–A5, именованные Fossil regression и bun typecheck без ошибок. Обязательный _build.ps1 exit0; предупреждения сохраняются отдельно. Исторический replay неизменен: его assertions описывают прежнее поведение и не используются как post-change suite.

## Задачи

- [x] F1. Новый исполняемый regression + baseline до продуктовых правок; аудит плана read-only роботом. ✓ CONFIRMED: SU-1 run 20261014T064615Z_442b382c PASS; новая регрессия 20261014T065309Z_6d3fab4a штатно FAIL на busy: expected200/actual500, 21 assertions, exit1. Renderer, реальный SDK/HTTP/Fossil и idle прошли до отказа. Смит подготовил тест и отметил A2 order/A4 coverage gaps; родитель добавил проверку порядка и исправил harness wire-match/cleanup перед baseline. A4 whole-route остаётся Inferred. <!-- sv: { keywords: { regression: 0.6, baseline: 0.4 }, dominant: Тест отказывает на измеренном дефекте до ремонта. } -->
- [x] F2. Робот реализует общий подтверждающий обработчик, await/error UI и canonical owner. ✓ CONFIRMED: родитель прочитал полный diff трёх путей, поправил форматирование; runtime 20261014T065908Z_364d2130 — 7 pass/0 fail, 79 assertions, idle и busy SQLite+BEFORE, redo AFTER, HTTP500/200-no-target → видимый error при сохранённом вводе/меню. Typecheck 20261014T065636Z_d9231e4a exit0. Canonical composite-binding подтверждён текущим исходником, сквозной composite не исполнялся. <!-- sv: { keywords: { session-revert: 0.6, result-confirmation: 0.4 }, dominant: Изменения интерфейса зависят от подтверждённого отката. } -->
- [x] F3. Независимые runtime readback, typecheck, build, документация, архив доказательств и scoped commit с переносом плана. ✓ CONFIRMED: runtime364d2130 и regression8791e13b (14 pass/0 fail,67 assertions), typecheck d9231e4a, build bd75f1a7 exit0, 0 dropped/truncated; полный архив experiments_history/2026-10-14_session-revert-repair с SHA256 manifest. Смит выполнил read-only аудит diff; родитель проверил его утверждения и отдельный abort-error oracle. Документация fossil-snapshot обновлена. Перенос и commit входят в эту атомарную change; финальный readback после commit обязателен. <!-- sv: { keywords: { regression: 0.5, closure: 0.5 }, dominant: Закрытие опирается на реальный результат, а не отчёт робота. } -->

## Claims, risks, rollback

Claims: C1 await+abort устраняет измеренный busy-отказ меню; falsifier A2. C2 возвращённый session.revert.messageID подтверждает выбранную user-точку; falsifier A3. C3 canonical owner адресует выбранное сообщение; falsifier A4. До runtime все Inferred. Серверный HTTP200 сам по себе успехом не считается.

R1 параллельные изменения: перед apply сверить source pins, неожиданный diff → stop/re-ground. R2 pending handler/unhandled rejection: catches с log+toast, никаких UI side effects в failure branch. R3 stale session_status: допускается безусловный idempotent abort, реальный runner проверяется сервером; не retry по таймеру. R4 двойное Enter: защита от параллельного revert в диалоге при необходимости. R5 инфраструктурный тестовый сбой: отдельная qualification, хранить красные логи. Rollback — scoped revert этой работы, без undo текущей пользовательской сессии.

SVM: turn=undo-repair; parent=undo-runtime-reproduction; fixed goal=заголовок intention; evidence=7fc9765093 и current source pins; oracle baseline EXPECTED_FAIL, post PASS в измеренном scope. Portfolio audit: root inventory закреплён в scratch portfolio-inventory.json; oracle/strategy-проверка всех чужих планов не выполнена. Это явный residual общего портфеля, не PASS на все 99 прежних боксов. Parent goal механической непрерывности поддержан конкретным TUI repair; глобальный SUCCESS по G9 не заявляется.

## Retained failure / instrument qualification

✓ CONFIRMED: первый post-run 20261014T065636Z_ec3e4f93: 6 pass/1 fail на ожидании нового toast по object identity; wire уже содержал no-target200. Класс HARNESS — Solid store сохраняет proxy identity при смене toast fields. Контрмера: известные TOAST_A→TOAST_B с native frame readback перед целевым тестом, reset каждого error-кейса через публичный show(info) и проверка value/variant. Повторный прогон 364d2130 записал stableReference=true и все семь тестов PASS. Ошибочный лог сохранён, predicate ошибки продукта не ослаблен. Edit-инструмент Смита дважды отверг устаревшие fromHash и ничего не записал; родитель применил проверяемый patch после reread. Это сработавший guard, не доказательство изменения файла посторонним процессом.

## Bounded closure и residual

✓ CONFIRMED (финальный source diff, native runtime, readback, типизация и build): измеренные отказы меню устранены; HTTP200 без точки больше не принимается за успех. Исторический baseline failure сохранён, product paths ровно три, сервер/Fossil не изменены. Обязательный build очистил .temp/test и собрал только dist; предупреждения syn0.11.11 и Vite сохранены.

Остаются: whole-TUI/slash/composite navigation, реальный LLM busy и конкретная живая сессия владельца; эти сценарии не объявляются Exact. Canonical owner в composite исправлен по источнику и typecheck; UI-стенд получает owner на входе. Установка dist в bin не входит. Риск редкого teardown-failure может маскировать исходный assert в тесте; измеренные teardown завершились. Аудит Смита не читал request.test и ошибочно назвал abort-error непокрытым — родитель опроверг это фактическим тестом/логом. Отсутствие portfolio-inventory в корне было неверным locator в brief; настоящий файл в experiments/2026-10-14_session-revert-repair, инструмент вернул корректный File not found.

Stop record: acceptance=измеренные A1/A2/A3/A5 и source-binding A4; failure approaches=optimistic fire-and-forget и object-identity toast predicate; stop_reason=bounded repair завершён по указанным оракулам; reopen_when=новый failing reproducer на этих путях либо конкретный live отказ с sessionID/messageID/response. Остальные активные планы не закрывались и не присваивались этому результату.
