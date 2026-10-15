<!-- intention: длинный ход Haiku 5.5 не дал видимого ответа, а короткий прямой API smoke не локализует причину -> воспроизводимое исследование wire, SDK, replay, gateway и TUI с разделёнными причинами, контролями и границами вывода -->
<!-- goal_sv: haiku-research,wire-sdk-parity,stream-observability,independent-controls -->
# Haiku 5.5: исследование полного пути ответа

Статус: RESEARCH VERIFIED; фиксация bounded research в собственном commit. Вид работы: READ + PLAN_WRITE + MODIFY_CANDIDATE; product source не менялся в рамках исследования. Исправление Haiku не заявлено.

```yaml
Keywords: haiku-research 0.35, wire-sdk-parity 0.25, stream-observability 0.25, independent-controls 0.15
Semantic dominant: Локализовать отсутствие видимого ответа Haiku по независимым наблюдениям каждого слоя.
md5: 521cbe68349a4f82b176d9e028fa703d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Связь с направлением проекта

`plans/MASTER_PLAN.md`, Goal level 0: проверяемое состояние каждого хода и turn-loop/stall прежде новых поверхностей. Исследование определяет, что произошло в незавершённом ходе, отделяет состояние от пустого индикатора и сохраняет воспроизводимый следующий шаг.

## Контракт результата

- Исходный request привязан к session/message/request id, SHA-256 исходного capture и строкам журналов; отмена не названа ответом провайдера.
- Контракт Haiku 5.5 сверяется с официальными документами и установленным SDK; 4.5 — отдельный контроль.
- Offline fixtures различают параметр display, пустой signed reasoning и pipeline loss; есть EXPECTED_FAIL, способный опровергнуть вывод.
- Live matrix записывает HTTP, транспорт, временные точки, события, usage и stop reason; изменение одного поля не выдаётся за повтор исходного запроса.
- Отчёт содержит выводы, альтернативы, retained failures, риски и точный следующий шаг. Полный пользовательский ход не объявляется исправленным без его собственного oracle.

## Границы и полномочия

Основание: запрос владельца «давай разбираться с Хайку, поведем всестороннее исследование».

- Пути записи: этот план, его завершённая версия, `experiments/2026-10-16_haiku-research/**`, проверенные результаты в `experiments_history/2026-10-16_haiku-research/**`, один собственный progress entry, собственная ссылка в docs index, generated map через SVM renderer.
- READ: текущие source/test/dependencies, runtime logs/captures, readonly SQLite. Credentials читаются только для авторизованных запросов и не печатаются/не сохраняются.
- EXTERNAL_EFFECT: только официальная документация и диагностические запросы Anthropic; максимум 12 inference requests, максимум 8192 output tokens на запрос, 150 секунд на запрос. Никакого исполнения возвращённых model tool calls.
- Bounds: step_budget=60, tool_budget=100, loop_budget=3, depth_budget=2, time_budget_ms=2400000. Субагенты получают часть этого бюджета.
- Никаких product/kernel/config изменений, bin promotion, чужих sessions/abort, full package suite, массового stage или удаления чужих файлов.
- Сборка после package tests выполняется один раз через штатный `_build.ps1`; только candidate `dist/`, с собственным lock.

## Кандидаты и независимые альтернативы

| Лист | Вопрос | Качество исходной предпосылки | Дискриминатор |
|---|---|---|---|
| R1 | Что пришло до abort? | Inferred, журналы и capture доступны; tier 2 | id/time/DB/raw-response cross-read |
| R2 | Что допускает Haiku API? | Hypothetical до официального readback; tier 2 | vendor docs + ограниченный live arm |
| R3 | Какие параметры реально сериализует SDK? | Inferred, source; tier 2 | настоящий SDK с capture-fetch |
| R4 | Сохраняется ли signature-only reasoning? | Inferred, source; tier 2 | direct SDK vs transform → SDK |
| R5 | Отличает ли UI thinking-start от видимого текста? | Inferred, source; tier 2 | event/part projection, возможный отдельный rendered oracle |
| R6 | Пропадает ли partial response при abort? | Inferred, противоречие docs/runtime; tier 2 | локальная transport fixture с явной отменой |

Медоиды: R1 (исторический факт), R3/R4 (wire/replay), R5/R6 (наблюдаемость); R2 независимо ограничивает их интерпретацию. Полного portfolio acceptance работа не заявляет; чужие открытые планы не закрываются.

## Задачи

- [x] **H1** — ✓ capture SHA-256 `40283d19ae32433e13b91b049b8506401f3856713be43e99499705fee6f39a41`, body SHA-256 `6f212a766cf332b0fb09d2c9bdcab16bf4e62c91355d4acc49fd19483cff5a93`; исторический abort отделён от ответа. `live-measurements.json` и private runtime capture. <!-- sv: historical-wire,request-identity,cancellation -->
- [x] **H2** — ✓ три независимых обзора, primary vendor readback, parent source hashes и fixture differential; `source-pins.json`, REPORT.md разделы SDK/официальный контракт. <!-- sv: vendor-contract,sdk-contract,independent-review -->
- [x] **H3** — ✓ SDK `20261015T165628Z_21a44b9c`, HTTP1 parent `20261015T170029Z_f8ef125b`, H2 parent `20261015T170413Z_04ea3748`; controls различают complete/truncated/aborted и late delivery. H2 exit=1 сохраняет два дефекта; actual TUI frame остаётся явно UNKNOWN, как предусмотрено контрактом исследования. <!-- sv: fixture-qualification,wire-capture,signed-replay -->
- [x] **H4** — ✓ 9 inference arms, все HTTP200/message_stop; исходные system/tools/messages сохранены, output cap изменён явно. Main `20261015T165513Z_4b8dea2c`, supplement `20261015T170122Z_dfdea369`; low/medium tool_use, high/max ограничились thinking. Сравнение времени diagnostic, не benchmark. <!-- sv: live-stream,timing,controlled-parameters -->
- [x] **H5** — ✓ отчёт и public-safe метрики перечитаны, 15 полных runner receipts сохранены, source pins сверены; ссылка в master map и docs index. Архив: `experiments_history/2026-10-16_haiku-research/`. Этот завершённый план входит в собственный scoped commit с его именем. <!-- sv: report-readback,retained-failures,plan-closure -->

## Smoke Tests

Предсказания ДО исполнения:

1. Fixture valid SSE: message_start → signed-empty thinking → text → message_stop. Reader обязан восстановить типы/порядок/подпись; truncated fixture обязан НЕ считаться complete (EXPECTED_FAIL).
2. Реальный SDK Haiku variant: adaptive/max, display отсутствует. Явный summarized должен попасть на wire; Opus 4.7 summarized и Haiku 4.5 enabled — controls. Это diagnostic, не требование автоматически менять поведение.
3. Signed-empty replay: прямой SDK сохраняет блок; current transform удаляет. Если оба сохраняют либо оба теряют, предпосылка пересматривается.
4. Live small default vs summarized: ожидается HTTP 200 и message_stop; summarized ожидает thinking_delta только если модель действительно выбрала thinking. Нет thinking на простой задаче не считается провалом harness; тогда заранее предусмотрен reasoning-нагруженный input при max, а исчерпание бюджета без thinking оставляет display-критерий непроверенным.
5. Исходная большая история с ограниченным output budget: результат неизвестен заранее, diagnostic only. Сравниваются явно объявленные изменения параметров, не приписывается эквивалентность исходному 125000-token budget.
6. Focused package baseline: `test/provider/transform.test.ts`, `test/provider/transform-anthropic-adaptive.test.ts`, `test/session/reasoning-finalize.test.ts`; ожидается PASS, расхождения классифицируются. После него `_build.ps1` через cmd_runner.
7. Gateway abort fixture обязана прочитать partial-response artifact и различить complete/aborted; недоступный actual TUI frame явно остаётся границей, а не подменяется source/part proof. Пара effort low/max использует одинаковую историю, display и output budget; сравнение времени на одной паре diagnostic, не latency benchmark.

## Риски и rollback

Чужая dirty work сохраняется. Raw user history и credentials не входят в tracked отчёт. Оборванный/ограниченный запрос остаётся таким в отчёте. Diagnostic harness не меняет provider configuration и не исполняет tools. Новые файлы можно удалить адресно; существующие product files не затрагиваются. Research conclusion не служит разрешением на product repair.

## Итог, критерии и продолжение

✓ IMPLEMENTATION_RESULT: product actual_diff=none; новые research harness, measurements, synthetic captures, отчёт, plan/index/progress routing. Package baseline 188 pass/0 fail/373 expect, run `20261015T165514Z_967905af`. ✗ Полный build `20261015T165629Z_9cde306d` exit=1: package candidate и smoke прошли, release collection заблокирован работающим `dist/bin/opencode.exe` PID18400. Работающий сервер не останавливался; это отдельный остаток, не PASS сборки.

| Acceptance | Наблюдение | Дискриминатор / граница |
|---|---|---|
| Исторический ход привязан | capture/body hashes, журналы, SQLite readback | abort не превращён в provider completion; полного response нет |
| Vendor и SDK разделены | official docs + current SDK pins + wire fixtures | Haiku adaptive vs legacy enabled, explicit summarized vs omitted |
| Replay и stream различены | direct SDK preserves signed-empty, transform drops; UTF-8 fixture | truncated stream EXPECTED_FAIL; нет подмены actual TUI source proof |
| Live matrix ограничена | 6+3 arms, cap4096/8192 и deadlines, usage/stop reason | tiny cap EXPECTED_FAIL по наличию ответа; CRT formatting FAIL сохранён |
| Отчёт воспроизводим и ограничен | receipts, hashes, public-safe projections | H2 defects и build FAIL сохранены; product fix не объявлен |

Research outcome: наблюдаемые причины разделены; это не глобальный SUCCESS портфеля. Полная повторная квалификация чужих активных планов не выполнялась; generated map — routing, не oracle их завершения.

Residual goals (отдельный repair scope): signed-empty replay; H2 signal propagation и cleanup; actual Session/TUI frame; полноценный tool loop/effort eval; сборка при свободном output path. Falsifiers и минимальные новые instruments перечислены в REPORT.md. Историческая окончательная причина остаётся UNKNOWN без исходного response или согласованного воспроизведения исходных параметров. Продолжение начинается с существующих fixture receipts, не с нового поиска того же.

План перемещён по результату ограниченного исследования; ни один из перечисленных ремонтов не отмечен выполненным. Reopen research при изменении source hashes, расхождении captures или новом response evidence исходного request.
