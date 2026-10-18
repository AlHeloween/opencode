<!-- goal_sv: Keywords: reference-impact 0.40, independent-oracle 0.30, fossil-provenance 0.20, bounded-output 0.10
Semantic dominant: Прямые ссылки диапазона проверены по независимым raw SCIP и Fossil endpoints с сохранением границ доказательства.
md5: a61c38f2749d40b09582e7f60c143dab
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 64b87d3a905c4fe2a1396db50f72c8e1
-->
# DAIS: прямые references диапазона Fossil

## Проверенный результат

CONFIRMED ✓ native CLI `reference-impact` и stdio MCP `referenceimpact` возвращают
прямые ссылки на определения изменённых файлов обоих концов диапазона. Профиль
`direct_scip_references_v1`, `semantic_status=unknown`. Оба graph snapshot проходят
реальную verification против заданного полного target hash. Ответ сохраняет
target/comment/SV, snapshot, instrument SHA256 и Fact origins: raw SCIP ordinal,
index SHA256, путь и Fossil file artifact hash.

CONFIRMED ✓ независимые oracle runs `20261017T235251Z_b9ba0847` и
`20261017T235252Z_2487db71`: 436 и 182 predicates. Root повторил **архивный**
воспроизводитель на новых disposable repos: `235408Z_084d24a8` и
`235408Z_847baa14`, те же 436/182 predicates, exit0, dropped0/truncatedfalse.
Все state.json и полные stdout_text.log сохранены в runs/; wire transcripts
содержат настоящие JSON-RPC requests/responses, не вызовы handler напрямую.

Рабочий корпус: 11 frozen committed Go inputs из source revision
`828ba5cdd5150a750ea5532874395105ba42043d`; compiler Windows cohort — четыре файла.
В owned fixture к `internal/fossil/provider.go` добавлен комментарий, затем реально
запущен native producer с `--previous-bundle-ref`, опубликованы новые artifacts.
Независимый Fossil SQL endpoint map находит **все четыре** changed paths:
provider.go, ci/capture.json, ci/index.scip, ci/inputs.json. Generated paths не скрыты.

CONFIRMED ✓ независимый raw protobuf decoder получил 94 witnesses: 47 before и
47 after, в capture.go и previous.go. Четыре function references из ранее
квалифицированного compiler golden (33 definitions/67 references) входят в этот
набор. Остальные witnesses включают ссылки на пакет/типы/поля, а не только вызовы.
Эталон строится из raw SCIP и independently read endpoint manifests, не из graph
или MCP результата. Совпадают ordinals, ranges, canonical symbols, matching
definitions, полный affected set, coverage, targets, source hashes и receipts.

## Различающие контроли

CONFIRMED ✓ небольшой отдельно созданный native Go corpus дал 26 witnesses
(13+13). A.Same и B.Same различаются canonical identity; перенос Moving в новый
файл и удаление неиспользуемого Deleted видны в diff/coverage. Package-level
function values остаются references, без притворного преобразования в calls.
Проверены limit1 с полными total/affected/side counts, no-op и reverse endpoints,
stale before, отсутствующий snapshot, invalid full hash/limit, дополнительные
MCP аргументы и EOF stop. MCP использовал обычный 10s tool deadline.

CONFIRMED ✓ валидная detached Protobuf-копия изменяет target одного occurrence
по конкретному raw адресу. Независимое декодирование меняет expected set на
93 вместо94 /25 вместо26; исходный результат его не проходит (EXPECTED_FAIL).
Оригинальные raw artifacts остались побайтно неизменны. Mutated copies сохранены.

CONFIRMED ✓ baseline `234438Z_32e999a0` PASS; API RED `234631Z_bcfc9575` и MCP RED
`234742Z_841fb69f` отказали на отсутствовавшем поведении. Финальный focused I1
`235205Z_064ef547`:84 PASS cases; I2 `235210Z_55c70c08`:11 PASS cases.
Полный explicit 10-package regression `235242Z_dbb76d8b`:166 PASS cases, exit0,
capture loss0. cmd/dais-ci сообщает no test files; его executable проверяется
реальным capture/search/MCP oracle. Full package Bun suite не запускался.

CONFIRMED ✓ обязательная _build.ps1 -Task build `235412Z_a123cd8e`: exit0,
candidate10.0.1434 только в dist, без promotion. Полный log сохраняет Rust future
compatibility warning (syn0.11.11), web dynamic/static import и chunk-size warnings.
Установленный runtime не заменялся.

## Обнаруженные и сохранённые дефекты

CONFIRMED ✗ read-only review обнаружил пропущенный per-side matching count и
проверку byte cap только после потенциально квадратичной сериализации ambiguity.
Repair RED `235129Z_83d9a60b` сохранён. Coverage теперь считает matching_references
до output limit. ValidateReferenceImpactSize считает metadata, witness skeletons
и cached unique Fact encoding costs с ранним отказом, не создавая полный
размноженный JSON. CLI и MCP вызывают его до основной сериализации. Runtime
контроли exact encoded byte boundary, большого fanout, inconsistent Fact ID и
реального MCP response bound прошли в указанных focused/regression runs.

CONFIRMED ✗ `235033Z_c320705a` — HARNESS defect: контроль запрещал всю строку
BValue, хотя на ней также находится допустимая ссылка на package fossil.
Класс ошибки: line filter объединяет разные symbol occurrences. Контроль
исправлен до canonical B.Same target; raw golden и product не подгонялись.
Исходные script/report и FAIL сохранены в harness-history/ и impact-small-v1.json.
v1production `235032Z_48733ee2` прошёл433 predicates на прежнем schema.
Исторический v2 script SHA8639f105d2af8a41e4aa879e0386cbcbc49c79f078fc635776337f119e49fe27
восстановлен и проверен побайтно. Финальная версия добавляет только отдельный
work-root/report output route; полный архивный повтор квалифицирует этот маршрут.

## Контракт и ограничения

Provider.Changes — единственный источник changed paths. По каждой стороне берутся
все nonempty definition identities изменённых документов; non-definition
occurrences сопоставляются по canonical Fact.Object вне всего changed set.
Несколько определений и duplicate ordinals сохраняются. Local identities остаются
document/index scoped. Snapshot origin и applicability target не смешиваются;
исторический snapshot с новым same-tree SV target проверен отдельно.

Coverage: indexed/unindexed/absent changed paths, changed definition occurrences,
полное matching_references. Unbound означает non-definition occurrence без Object
(включая highlight-only); unresolved — nonempty Object без определения в данном
индексированном корпусе. Это не диагноз ошибки indexer. Входные facts должны быть
полными в установленном MaxFacts; выходное усечение явное. affected_files всегда
полное множество внешних совпадений, без fallback на собственные changed files.

Не доказаны полнота producer external reads, semantic correctness всего SCIP,
поведенческий или транзитивный impact, call graph, Delphi/1С, масштаб5M/p95/RSS.
Consumer cutover не выполнялся. Семь consumer capability classes и несовпадение
callerCount с arbitrary cross-file edges сохранены в grounding. Следующий binding
должен менять truthful consumer contract, а не подставлять references в callers.
Root Z4/Z5 и отдельный freshness plan остаются ACTIVE.

## Целостность и продолжение

MANIFEST.json закрепляет архивные bytes и source revision. Независимый
verify_manifest.py пересчитывает hashes; completion transaction дополнительно
читает те же pins из staged/committed Git blobs. Исторические абсолютные paths в
reports — адреса исполненных runs, не инструкция переиспользовать старую DB.
REPLAY.md запускает fresh production и small fixtures из archived scripts/inputs.
Fossil runtime DB и binaries не включаются в архив; исходные raw indexes,
manifests, receipts, prepared source files и полные failures сохранены.

CONFIRMED ✓ финальный renderer `235808Z_f5e8b6da`: два одинаковых hashes,
missing-marker EXPECTED_FAIL, gapsBefore[]. Read-only review повторно прочитал
исправленные bounds/counts и actual runtime reports; завершённый child указан
в hand-owned MASTER:116, ETA0 — child:18. portfolio-observation.json сохраняет
37 top-level Markdown files; canonical renderer учитывает35active plans и
144open boxes. Чужой vector/manifest debt не закрыт.

Инструменты: native Go/Fossil/Zoekt/SCIP, raw decoder, stdio client и cmd_runner
дали адресуемые результаты. HARNESS class whole-line filter был исправлен и
перепроверен; все сохранённые runner logs завершены без capture loss. Root build
warnings сохранены, их отсутствие не заявлено. Ничего не устанавливалось в bin/.
