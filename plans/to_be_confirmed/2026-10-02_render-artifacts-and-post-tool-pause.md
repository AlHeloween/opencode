# Артефакты отрисовки и пауза после инструмента

<!-- intention: повторяющиеся символы поверх TUI и остановка продвижения агента после редактирования -> корректная отрисовка и непрерывное продвижение агента с измеренной проверкой -->

Статус: TO_BE_CONFIRMED; revision 3. Исходная пауза исправлена в исходниках; артефакт экрана не воспроизведён. Сигнал возобновления: кадр повреждения вместе с emitted ANSI/framebuffer либо разрешённая проверка новой сборки в живой сессии.

```yaml
Keywords: rendering 0.40, latency 0.35, reproduction 0.25
Semantic dominant: Различить источник артефактов экрана и измеренную паузу после инструмента.
md5: f79b50a306cb4e1286d942e7605ad3fb
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Основания

- ✓ `git status --short --branch`: чистая `Local_Development` на входе.
- ✓ Снимок пользователя: повторяемые Malayalam-символы поверх читаемого интерфейса.
- Свидетельство пользователя: resize убирает артефакт; замирает продвижение агента после инструмента, не Windows.
- ✓ Read-only SQLite `D:/zPascal/XEComponents/.opencode/data/opencode.db`: session `ses_f555b44c8ffe6lJrTR69KN5zf3`, Malayalam присутствует в сохранённых частях.
- ✓ Журнал этой сессии: runtime `10.0.1178`; edit 53/111 ms. После finish-step до следующего process в трёх последовательных шагах 51.636–51.719 s; ttfb следующего запроса 2.368–2.736 s. Пауза есть и после run/read.
- ✓ `renderer.custom-stdout.test.ts` Ghostty width profile: cmd_runner `20261002T132817Z_53176418`, 1 PASS, 0 FAIL, без потерь журнала.
- ✗ Исходный native script не запустился: `20261002T133005Z_04b7e2fb`, `sh` отсутствует в PATH. Git shell найден на диске и квалифицирован перед повтором (результат ниже).
- ✗ Codegraph lookup Zig возвращает нерелевантный fallback; native ownership читается непосредственно из текущих файлов.

## Приёмка и Smoke Tests

1. RENDER: Malayalam -> ASCII/пустые клетки -> частичное обновление -> resize. Oracle: emitted ANSI, проигранный через независимый VT, соответствует текущему framebuffer; внешний пиксельный дефект остаётся открытым без кадра его воспроизведения.
2. PAUSE: привязать промежуток finish-step -> census/process к конкретной ожидаемой операции; воспроизвести задержку на ограниченной фикстуре. После исправления тот же oracle должен показать устранение задержки без потери защищённого поведения.
3. Сохранить посторонние изменения; не запускать и не изменять `bin/`; не изменять клиентский проект, текущую сессию или её данные.

## Задачи и привязки

- [x] ✓ R1 — диагностическая приёмка нативной замены/стирания: native `20261002T133319Z_351b237f` exit 0, 129/131 (2 skipped, не входят в доказательство); новая диффовая проверка `20261002T134323Z_92806c34` exit 0, 2/2. Это не закрывает исходный визуальный дефект.
- [x] ✓ P1 — источник 45.519 s ожидания локализован по живым timestamps и независимому MCP queue probe.
- [x] ✓ P2 — cached helper и immediate call-site; настоящий persisted regression RED-before -> GREEN-after; 40/0, types exit 0; документация обновлена.
- [ ] R2 — первый источник повреждения экрана остаётся Unknown. Диффовый VT test и отдельный Windows Terminal не воспроизвели его.
- [ ] L1 — применение новой сборки к запущенному runtime и измерение end-to-end паузы. `bin/` не изменялся, живой бинарник не запускался этой работой.

### P2: измеренная привязка

- ✓ Exact probe `codegraph_explore(projectPath=XEComponents, six ClientSoft files)` занял 47 337 ms и вернул `busy ... waited 45s in the queue`.
- ✓ Live read-back: finish-step 13:33:37.175Z -> session_diff mtime 13:33:46.472Z -> user message update 13:34:31.991Z -> process 13:34:32.044Z. Интервал записи diff -> update user составляет 45.519 s.
- ✓ Воспроизведённый путь runtime `10.0.1178` и исходного helper: processor.ts `summary.summarize` -> summary.ts `impactForToolFiles` -> mcp-client.ts `codegraph_explore`; это ожидание после каждого шага при уже накопленных diff.
- Binding: `summary.ts` — immediate summarize использует readonly SQLite pack, `enrichRange` оставляет MCP refresh на cadence диапазона. Источник cached impact называется явно; свежесть не утверждается.
- SV binding: latency 0.60, summary 0.25, regression 0.15. Expected diff: один helper mode и immediate call-site; тест сохраняет реальную user summary с символом из SQLite без MCP runtime. Red-before: символ отсутствует при живом текущем helper, потому он требует MCP; green-after: символ и diff прочитаны обратно.
- ✓ R1 toolchain: подготовленный Zig `external/zig-x86_64-windows-0.16.0/zig.exe`; Git shell доступен. Native diagnostic `20261002T133319Z_351b237f` завершён: exit 0, 129/131, два skipped не входят в доказательство.

## Authority / envelope

Основание: сообщение пользователя о дефектах и указание сессии; READ и PLAN_WRITE разрешены, ограниченный STABILIZE после воспроизведения входит в запрос. MODIFY_CANDIDATE — `experiments/2026-10-02_render-pause/`; MODIFY_PROJECT — только доказанная привязка в двух указанных пакетах и их тесты. PROMOTE_STABLE/SELF_MODIFY/EXTERNAL_EFFECT отсутствуют; `bin/` запрещён. Остаточный предел: 35 вызовов инструментов, 24 рабочих шага, 3 корректирующих возврата, глубина 2, 1 200 000 ms от записи плана; новые эффекты требуют пересмотра. Rollback: обратный scoped patch, чужие hunks не трогать.

## Открытые риски и residual

- Причина первого повреждения экрана не установлена; resize — свидетельство, не oracle.
- Длительность записи не объясняет последующую паузу; проверять конкретную ожидаемую операцию.
- ✓ Native harness квалифицирован и завершил два filtered запуска; визуальный дефект клиента ими не покрыт.

## Oracle stamps / implementation result

✓ Baseline: `bun test test/session/summary-exact-live.test.ts test/session/summary.test.ts test/codegraph/sqlite-pack.test.ts`, `20261002T133600Z_5a2247c5`, 21/0.
✓ EXPECTED_FAIL: новый `per-step summary` на старом helper, `20261002T133818Z_54f7939b`, marker отсутствует в persisted summary. SHA256 stdout: `cde32c80cea287dfde5046a7fe66143e4834a26540f4557ffbf5212a2b08adae`.
✗ Первая правка использовала устаревший overload Effect.try; typecheck назвал TS2345/TS2740. Классификация IMPLEMENTATION, исправлено object overload, assertion не ослаблялся.
✓ PASS: пять файлов (summary-exact-live, summary, summary-anchors, mechanical-writer, sqlite-pack), `20261002T134017Z_165481fa`, 40/0, cached fixture 201.66 ms. SHA256 stdout: `9be5dca89992b66edf8fc6a909676c2f9ae865a92555f11c843a4d2ee8d75e73`.
✓ PASS: `bun typecheck`, `20261002T134019Z_5c6cbaa8`, exit 0. SHA256 stdout: `e552052b9e31b7c42678a80d4335a4eefb95c23fc62b3ed98b7432332e7e51ec`.
✓ Native differential PASS, `20261002T134323Z_92806c34`, SHA256 stdout `a27d2e44a07d494c389fc962a139985e48203abb7bfc4bd32a459397db0a38c2`.
✓ Windows Terminal pixel diagnostic: `20261002T134626Z_01a83e2d`, cmd_runner direct terminal, 20 rows Malayalam/blank -> ASCII; `experiments/2026-10-02_render-pause/windows-terminal-clear.png` показывает весь тестовый объект, читаемые ASCII строки и отсутствие Malayalam в финальном кадре. stdout direct-terminal не захватывается по контракту. Это локальный clean результат, не воспроизведение клиентского дефекта.
✓ Source SHA256 `summary.ts`: `f9c91489a1cb0de224ec00e50cfb83898a1099e2a93761a9ff4db66baa921e81`; тест SessionSummary: `6331f18fa9ad5e7c14fcce8326d7f12a02573b92304271e39659de64d57c97f1`; native test: `807beb37fe6f5e20220db330c543f3753f72a12d6a3189c3fda89c2d29bd8bc2`.

## Closure / residual

Закрыта source-level PAUSE, не вся исходная приёмка. Остаток: live бинарник; источник первого повреждения экрана; отдельные 6–9 s перед записью session_diff. Следующий различающий oracle для R2: renderable text -> resolved framebuffer -> emitted ANSI -> pixels одного повреждённого кадра. До него renderer менять нельзя.
Риски: cached index не обещает свежесть; SQLite busy timeout до 5 s остаётся другим механизмом. Старый план CodeGraph C2 не закрыт: его свежесть отдельно не проверялась.
Инструменты: cmd_runner state+весь stdout прочитаны, dropped=0/truncated=false для captured runs; native progress deduped после whole-file read. Shell PATH квалифицирован Zig0.16/Git sh. Codegraph Zig lookup не нашёл owning file и дал нерелевантный fallback; источник прочитан напрямую. MCP показал явную очередь; cached immediate consumer устраняет ожидание этой очереди, а не ремонтирует сервер.
