<!-- goal_sv: Keywords: native-mcp 0.35, compiler-oracle 0.30, fossil-evidence 0.25, parity-boundary 0.10
Semantic dominant: Нативная агентная навигация проверяется по независимому компилятору и адресам неизменных версий Fossil.
md5: 891ac7e0b5d84f6e92c013a76bd45f28
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
-->
# DAIS: native MCP, навигация и рабочий Go-корпус

Состояние: проверенный ограниченный срез, архив готов к named completion commit.
Начало эксперимента 2026-10-17,
возобновление 2026-10-18 (Asia/Singapore). Все run IDs используют UTC.

## Что проверяется

`symboldefinition`, `symbolreferences`, `codesearch`, `indexstatus` доступны через
native Windows stdio MCP на официальном Go SDK v1.8.0. Запуск закрепляет полный
Fossil target, graph snapshot и search generation. Проверка происхождения
исполняется перед каждым tool call, возвращает SHA256 текущего executable.
Исходный Fossil читается без записи; execution receipts сохраняются в derived
SQLite. Общий `semantic_status` остаётся `unknown`.

## Корпус и независимый эталон

CONFIRMED ✓ `corpus-source-manifest.json`: 11 побайтно сохранённых committed
входов, 96792 bytes, source Git `828ba5cdd5150a750ea5532874395105ba42043d`.
Сохранены настоящие go.mod/go.sum, тесты и platform alternatives. Компилятор
Go1.26.5 Windows/amd64 выбирает четыре production файла, 36395 bytes:
capture.go, previous.go, publish_windows.go, provider.go. Тесты и publish_other.go
не входят в semantic cohort; текстовый поиск охватывает все 11 файлов.

`typed-golden.go` использует стандартные go/parser/go/types и отдельный Go list
export inventory. Он не читает SCIP, DAIS graph или CodeGraph. Квалификация
`110736Z_5ee75ddb` проверила заранее заданные 5 определений/3 ссылки, одинаковые
имена методов разных типов и unexported function. Broken-types control даёт
INCOMPLETE, пустую выдачу и ненулевой exit. Ранние HARNESS failures сохранены.

CONFIRMED ✓ `110818Z_e824b2d6`: compiler golden — 33 function/method definitions,
67 explicit typed references. `111122Z_7b16b13b`: 21 predicate независимого
декодера raw protobuf, без missing/extra associations в этом cohort.
Archive capture `111929Z_cf0ed3c4`, compiler `112000Z_7a71285c`, raw comparison
`112045Z_8954840e` повторили результат в новых disposable paths.
Из архивного source собран отдельный compiler instrument `112143Z_8276a2bb`;
`112204Z_67a46666` вернул те же definition/reference arrays.

Это ограниченная проверка semantic agreement, не доказательство правильности
индексатора на всех программах, языках или отношениях.

## Различия с замороженным CodeGraph

CONFIRMED ✓ `codegraph-subset.json`: hash каждого из четырёх compiled source
совпадает с исходными байтами. Единица сравнения — source file, строка и typed
target; declaration span CodeGraph не приравнивается к identifier span SCIP.

| Исходная позиция | Go/compiler и SCIP | CodeGraph subset |
|---|---|---|
| capture.go:262 | Provider.ListFiles, provider.go:139 | unresolved/failed |
| capture.go:267 | replacePrevious, previous.go:26 | тот же target |
| capture.go:320 | Provider.ReadArtifacts, provider.go:193 | unresolved/failed |
| previous.go:27 | Provider.ListFiles, provider.go:139 | unresolved/failed |
| previous.go:69 | Provider.ReadArtifacts, provider.go:193 | unresolved/failed |
| capture.go:453 | publishDirectory, publish_windows.go:5 | publish_other.go:7 |
| provider.go:165 | Provider.ListFiles, provider.go:139 | тот же target |

Из этих семи различающих примеров не выводятся общая accuracy, p95, RSS,
ускорение или готовность полной замены CodeGraph.

## Сохранённые отказы и исправления

CONFIRMED ✗ `110642Z_d310749d`: прежний native producer выдал вложенный путь
`internal\capture\capture.go`; строгий импортёр отказал. Canonical producer
задаёт `filepath.ToSlash` до protobuf serialization, сохраняя explicit UTF8.
`110910Z_0a67c8b8` проверил source tree и сборку; `110937Z_f6e1d33f` прошёл
реальный capture/import/raw roundtrip. Оба raw индекса и bundles сохранены в
fixtures. Original module cache/external и готовый SCIP не переписывались.

CONFIRMED ✗ `111540Z_eb3c4270`: один historical-pin test вернул tool error;
прежний diagnostic formatter вывел указатели вместо текста. Изменён только
test diagnostic, timeouts и product code сохранены. Причина того отказа Unknown,
не FIXED. Три последовательных одинаковых 9-package прогона `111844Z_379721ca`,
`112055Z_5fc683b7`, `112214Z_6d20605f` прошли; последние два шли под wire load.
Reopen condition: повтор этого test с сохранённым JSON Content ошибки.

CONFIRMED ✗ `112010Z_9d95564e`: 1266 проверок двух production processes без
mismatch, но итог INCOMPLETE — BrokenPipeError во время отправки oversized frame.
Transcript содержит точный SDK refusal по максимальной длине и exit1. Harness
исправлен: раннее закрытие допустимо только вместе с EOF, ненулевым exit и
точной диагностикой лимита. Сам BrokenPipe не принимается за успешный control.
CONFIRMED ✓ повтор `200007Z_9253a529`: 1270 predicates, 2 fresh processes,
нулевые failures, exact SDK size refusal/exit1, source Fossil и original derived
index неизменны. Raw-client qualification `195937Z_0c48a134`: 5 predicates PASS.
Исходный INCOMPLETE и его wire transcript сохранены рядом с полным PASS.
Исторический oracle восстановлен в harness-history/ обратимым patch; его SHA256
`1ca9b4b54338f1d0458c897637918ef219f6971cf701056d748f667589ee49ee`
точно совпал с digest первоначального INCOMPLETE report. Исходный report не менялся.

CONFIRMED ✓ archive raw-stdio replay `200446Z_1e14a8db`: ещё 1270 predicates,
2 fresh processes на другом disposable Fossil snapshot/generation, failures0,
exit0/no capture loss. Использованы фактические archived scripts и rebuilt
compiler golden; исходные Fossil bytes и original derived index не изменились.
Проверки symbolic/byte addresses, limits и отказов повторены целиком.

## Регрессии и границы

CONFIRMED ✓ `195952Z_f0dc05c9`: десять explicit packages, 142 PASS test cases,
exit0, bytes_dropped0, truncatedfalse. `cmd/dais-ci` явно сообщает no test files;
его поведение отдельно покрывается compiled CLI и MCP oracles. Сборка MCP
`195952Z_71e2245c` exit0, executable SHA256
`e98b0e9e03dd2ef5d5cffc4649c867552cfed67216659eeb9f0e786ce6511712`.
CONFIRMED ✓ обязательная `_build.ps1 -Task build` `200051Z_1a440ab5`: exit0,
candidate10.0.1433 в dist, без promotion. Полный log сохраняет предупреждения
future Rust compatibility (syn0.11.11) и размера web bundle; capture loss0.

Native сборка использует scripts/go.ps1 с проверенным Windows Zoekt overlay и
`-buildvcs=false`. Прямой upstream build без этого пути не является процедурой
сборки данного Windows-кандидата; внешние sources остаются неизменны.

Открыто в родительском плане: consumer cutover, impact/call graph, Delphi/1С,
межъязыковое разрешение, 5M entities/performance, incremental producer execution,
долговечная публикация execution receipts и disk retirement. Навигация этого
среза — bounded full scan, не масштабируемый SQL query engine. MCP не установлен
в live host; bin/ и исходный live Fossil не менялись.

## Проверка архива и продолжение

MANIFEST.json закрепляет exact bytes архива (кроме самого manifest) и исходники
модуля/документации/плана. `verify_manifest.py --root <same-revision-checkout>`
пересчитывает их независимо. Git blob readback выполняется при completion commit;
это проверка содержимого, не самоссылка на hash собственного commit.
Дочерний план: plans_completed/2026-10-17_dais-navigation-mcp-corpus.md.
Родитель остаётся ACTIVE: следующий маршрут — актуальная инвентаризация consumers,
impact oracle и отдельный binding cutover после измеренного покрытия.

CONFIRMED ✓ renderer `200931Z_fdd6a486`: два одинаковых MASTER hashes,
missing-marker control EXPECTED_FAIL, gapsBefore[]. Карта содержит 35 active
plans/144 open boxes; foreign vector/manifest debt сохранён, whole-portfolio
SUCCESS не заявлен. Текущий inventory и стратегия — portfolio-observation.json.

Инструменты: cmd_runner сохранил полные завершённые logs без потерь; native Go,
Fossil, compiler golden, независимый protobuf reader и raw pipe client дали
адресуемые результаты. Первоначальный raw pipe harness не учитывал допустимый
ранний BrokenPipe при oversized frame; исправление подтверждено точным SDK
отказом и полным повтором. Pointer-only test formatter скрывал содержание ошибки;
теперь код сериализует Content. Причина старого одиночного test отказа остаётся
неустановленной и не выдана за исправление продукта.
