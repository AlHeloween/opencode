<!-- sv: evidence-graph 0.35, native-oracle 0.30, fossil-provenance 0.20, falsification 0.15 -->
# DAIS native evidence graph — первый исполняемый срез

Проверено 2026-10-17, Asia/Singapore. Дата каталога — начало эксперимента.
Родитель: `plans/2026-10-16_zoekt-scip-fossil-sv.md`.

CONFIRMED ✓ native Go/Fossil/SQLite/Win32 mmap, без WSL: immutable source pins,
код и лицензии находятся в модуле; [MANIFEST.json](MANIFEST.json) содержит SHA256
27 module files и 49 скопированных artifacts с byte-identical readback.
Первичные артефакты остаются в Fossil, таблицы графа имеют namespace `ci_graph_*`.

## Оракулы

| Инструмент | Receipt / run | Наблюдение |
|---|---|---|
| Независимый parent package tests | `20261016T160250Z_3a37d7bc` | CONFIRMED ✓ exit0: fossil/search/evidencegraph/graph CLI, полные state/log, dropped0 |
| Native graph build | `20261016T160306Z_07b6f7e3` | CONFIRMED ✓ exit0 |
| Native search build | `20261016T160306Z_b8cf9dc3` | CONFIRMED ✓ exit0 |
| Независимый binary SCIP → compiled CLI | `20261016T160358Z_3673c425` | CONFIRMED ✓ 26 named predicates, включая EXPECTED_FAIL |
| Совместный search/graph compiled CLI | `20261016T160746Z_a0d80ed8` | CONFIRMED ✓ 11 named predicates, общая SQLite, source repo byte identity |
| Обязательный `_build.ps1 -Task build` | `20261016T160358Z_b3889489` | CONFIRMED ✓ exit0, candidate dist, build lock released |

Первый внешний CLI прогон `20261016T155756Z_5611992c` остановился после15
проверок на отсутствии настоящих SCs arcs. После исправления тот же predicate
прошёл. [Первый отчёт](cli-first-report.json) сохранён вместе с отказом.
Старые M2 defects реально воспроизведены `20261016T155250Z_10ca6569`:
подменяемый caller SV, выдуманный unsigned SV, удержание searchers и неверный
serialized-byte bound. Исправления повторно проверены независимым parent suite.

Все полные журналы и terminal state находятся в [runs/](runs/).
Ошибки fixture/инструментов не вычеркнуты: missing env, Fossil rename/mtime,
mapped-file cleanup, missing API, offline contract и missing instrument passport.
Coarse mtime fixture исправлен настройкой mtime-changes off и commit --hash;
перезапущен весь соответствующий suite. Production GC не добавлялся.

## Что различает внешний оракул

[cli_oracle.py](cli_oracle.py) кодирует protobuf независимо от Go binding и
импортёра: фиксированные поля закреплённой SCIP schema. Источник — настоящий
disposable Fossil repo с пятью check-ins. Проверены локальные scopes, версии
packages, повторные occurrences, роли, все relationship flags, source addresses,
raw byte roundtrip и явная полнота страницы facts.

CONFIRMED ✓ отдельно проверены source repo SHA256 до/после import/verify,
idempotence/reopen, historical A после B, no-op SV, source mismatch, invalid
range и unchanged-current при отказе. Изменение только dependency даёт STALE.
Прямая подмена cached fact даёт сохранённую FAIL receipt; восстановление bytes
снова допускает PASS. Этот control выполнен на доставленном executable.

CONFIRMED ✓ [cli-final-report.json](cli-final-report.json) содержит receipts
PASS/FAIL/STALE. Их instrument_sha256 совпадает с фактическими bytes
`dais-graph.exe`: `5efb7bbca5731da7c2968125cc4fc676e35f77aa3e98a50827a2dd76010b85ea`.
Каждый receipt привязан к snapshot ID, predicate и input digest.

CONFIRMED ✓ [graph.scs](graph.scs) — наблюдённый экспорт A после PASS/FAIL
controls: shared symbol nodes, named common arcs, predicate membership,
claim/origin links и executed receipts. Python oracle читает реальные triples
и проверяет совпадение endpoints у повторных references/relationship, а также
различие локальных symbol scopes. SC-machine parser не запускался.

CONFIRMED ✓ пространство `cli-final-report.json.scs_sha256` — UTF8 текст stdout
с LF: `0ad300af0fd5d56722c08b6aebbe8fe0035d7dab9077fe72d81d0e3a42a3d6cf`.
Python write_text на Windows сохранил graph.scs с CRLF; точный raw artifact hash
из MANIFEST.json — `024581e1146b277b43836907e85a69f71857b9335917cca8101dceca2ad72e94`.
Нормализация CRLF→LF воспроизводит первый hash. Исходные отчёт и файл сохранены;
byte-identity SCIP проверяется отдельно по binary bytes и от newline не зависит.

[search_cli_oracle.py](search_cli_oracle.py) проверяет full A → delta B → no-op C,
исчезновение удалённого текста, stale revision guard, empty index, invalid
command, canonical SV и сохранность graph current в общей metadata.sqlite.
[Результат](search-cli-report.json).

## Повторение

Собрать оба exe по `packages/dais-code-intelligence/README.md`, затем запустить
скрипты из этого архива через cmd_runner. `cli_oracle.py` принимает --exe,
--fossil, --work-root и --report. Search oracle принимает --exe (dais-ci),
--graph-exe, --graph-report, --fossil и --report. Для --work-root нужен существующий
изолированный scratch directory. Скрипты создают собственный Fossil repo/home,
не касаются live snapshots и сохраняют fixture для readback.

SCIP schema: `e26a0b0fc83424dbfe6c703c0437d4703aec4aa0`; Zoekt:
`74e1e85839697c4c4eb8a6223cc3971e6c26da45`. Generated binding SHA256
`61179ef826a83046aea36226ab63fcd598e66d6c53702536eff5e5d73dd70307`.

## Границы и следующий эксперимент

Semantic correctness indexer остаётся **unknown**; подтверждены только fidelity,
valid ranges и применимость к заявленным bytes. Manifest сам не доказывает запуск
indexer. Нужен native capture pipeline реального SCIP producer.
Профиль UTF8 ограничен; UTF16/unknown schema отклоняются целиком. Call graph,
Delphi ↔ 1С resolution, полный OSTIS engine contract, 5 млн entities, p95/RSS,
MCP cutover и автоматическая Fossil publication evidence пока не проверены.
Historical receipt с прежним executable hash остаётся историческим результатом;
при смене инструмента требуется новый Verify.

Zoekt old/unpublished generations остаются на диске: безопасный retirement с
Windows unmap — отдельный residual. Current searcher cache ограничен; синхронный
unmap не обещается. Криптографическое доверие стороннему исполнителю не реализовано.

Инструменты: Fossil/Go/SQLite прошли fixture qualification; CodeGraph новых файлов
сначала дал нерелевантные совпадения, затем freshness banner разрешил прямое чтение.
Большие tool responses могли усекаться с предупреждением; решающие оракулы читаются
из полных сохранённых logs/state. cmd_runner final output dropped0/truncatedfalse.
Глобальный archive.cjs изменяет весь experiments tree; здесь скопирован только
явный набор после content check и проверен его byte readback.

Рабочее дерево общее и содержит чужие изменения. Полный portfolio SUCCESS не
заявлен: read-only explorer обнаружил три root plans без checklist и восемь
nested files с неустановленной активностью. Этот срез подтверждает свои criteria;
родительский переход с CodeGraph остаётся ACTIVE.
# Побайтовое хранение

CONFIRMED ✓ Git blob readback первого коммита обнаружил нормализацию CRLF в 27
из 76 закреплённых файлов. Локальные оригиналы не изменились. Каталоги модуля и
этого архива получили `.gitattributes` с `* -text`: Git сохраняет исходные байты,
включая generated SCIP binding и исторические receipts. Повторный oracle читает
все 76 blobs из исправленного коммита и сравнивает SHA256 с MANIFEST.json.

