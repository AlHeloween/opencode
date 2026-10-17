<!-- intention: CodeGraph остаётся обязательной зависимостью поиска и impact -> локальная навигация по коду через Zoekt/SCIP, связанная с Fossil diff и SV, с проверенной заменой потребителей CodeGraph -->
<!-- goal_sv: Keywords: fossil-diff 0.30, zoekt-search 0.25, scip-navigation 0.20, sv-provenance 0.15, codegraph-migration 0.10
Semantic dominant: Поиск и навигация получают проверяемые адреса версий Fossil и SV до замены потребителей CodeGraph.
md5: e8a16f092bce49a5b9f4130dd7c26e84
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# Zoekt + SCIP + Fossil + SV

**Status:** ACTIVE — ревизия 2, выполнение присланного владельцем плана M0–M2.

Продолжение владельца 2026-10-16: «Давай тогда делать это та игра которая стоит свеч» —
начать граф утверждений с доказательствами. Самостоятельный исполняемый срез:
[DAIS evidence graph](../plans_completed/2026-10-16_dais-evidence-graph.md). Он расширяет направление
SCIP/Fossil/SV; M0–M2 и будущая замена CodeGraph остаются задачами этого родителя.

Уточнение владельца: «Все надо бы нативно, WSL это точно не вариант.»
Windows runtime — нативные Go executable / Fossil executable / SQLite / Win32 mmap.
WSL, контейнеры и Linux bridge для Windows исключены. Linux qualification относится
только к отдельной нативной Linux-сборке; отсутствующий Linux-host не меняет
Windows acceptance и не разрешает подменять его WSL.

## Утверждённый владельцем следующий проход

Новый запрос 2026-10-16: приложенный «DAIS — Fossil-Native Code Intelligence»;
исходный текст сохраняется byte-for-byte в
`docs/proposals/2026-10-16_dais-fossil-native-owner-plan.txt` с SHA256 receipt.
Фиксированная цель владельца: «получить Sourcegraph-подобную навигацию по коду
без тяжёлого TypeScript runtime, без повторного анализа известных SV и без
создания второй независимой системы памяти». Начать с M0–M2.

ALLOW revision 2 по этому запросу: READ / PLAN_WRITE / MODIFY_CANDIDATE /
MODIFY_PROJECT (новый отдельный Go module `packages/dais-code-intelligence/**`,
документация и скрипты его сборки) / EXTERNAL_EFFECT (публичные зависимости Go).
Длительно работающий installed service, замена CodeGraph consumers, kernel и bin/
в этот проход не входят. Fossil fixtures — только experiments/ и тестовые temp dirs;
live snapshot.fsl разрешён исключительно для readonly observation. Клоны external/
остаются неизменными. Обязательный `_build.ps1` разрешён штатным путём, только
candidate dist/ и scratch, без ForceBuild и без promotion.
Бюджет нового прохода: 180 шагов, 240 tool calls, 12 возвратов, глубина 4,
7200000 мс. Первые READ slices: zoekt_m0 10 calls/480000 мс,
fossil_m1 12 calls/480000 мс. Последующие implementation slices получают
отдельный резерв из этого же корневого бюджета в grounded bindings ниже;
завершение READ slice не возобновляет его бюджет.

## Smoke Tests: M0–M2 критерии до реализации

- **M0a**: Go/Fossil primitives PASS на детерминированных fixtures; версии,
  лицензии, hardware/OS, source pins и Windows/Linux limitations зафиксированы.
- **M0b**: воспроизводимый current CodeGraph baseline на названном corpus/query set;
  index_time без наблюдения реального rebuild — Unknown, не оценивается по размеру DB.
  5 млн сущностей — целевой масштаб, не приписывается маленькому fixture.
- **M1**: Go RepositoryProvider Head/Changes/ReadFile/ListFiles; full hashes,
  metadata через Fossil SQLite, контент через поддерживаемый Fossil механизм;
  add/edit/delete/rename, Unicode/spaces, branch/merge, invalid revision/path,
  cancellation, byte-identity и неизменность source repo проверены runtime oracle.
- **M2**: полная и delta индексация дают одинаковые file:line/content/revision
  результаты; stale old token после update отсутствует; no-op SV не теряется;
  публикация атомарна, failed/cancelled job не меняет published generation.
  API search_code/search_regex/search_filename/search_symbol_text; generated,
  binary и служебные исключения задаются конфигурацией и отражаются в coverage.
  search_symbol_text — текст по symbol-like query, не доказанная SCIP навигация.
- Порог warm p95 ≤100ms и RSS < CodeGraph — экспериментальные критерии
  на одном утверждённом corpus. Непокрытая платформа/метрика остаётся residual.

Предсказания: Go hello PASS (уникальный marker), invalid Fossil revision/path
EXPECTED_FAIL; missing provider test до реализации FAIL, после PASS; stale query
до обновления обнаруживает mismatch, после full/delta mismatch отсутствует.
Windows Zoekt build — diagnostic до runtime результата: source уже указывает
Unix-only NewIndexFile/unix.Umask. WSL probe сообщил not installed; установку ОС
не подменять неквалифицированным fallback. M1 независим от этой portability leaf.

Новые задачи (старые Z1/Z3 остаются закрытыми своими receipts):

- [x] **M0a** — native Windows toolchain/source/platform qualification; Linux runtime не квалифицирован и исключён из Windows acceptance. <!-- sv: toolchain, portability, source-pins -->
- [ ] **M0b** — corpus и current CodeGraph baseline, воспроизводимый reader. <!-- sv: baseline, corpus, measurement -->
- [x] **M1** — Go Fossil Provider с реальными fixture tests и negative controls. Parent run 20261016T160250Z_3a37d7bc. <!-- sv: fossil-provider, revision-identity, oracle-equivalence -->
- [x] **M2** — Zoekt full/delta adapter и atomic publication oracle на fixture; compiled CLI 20261016T160746Z_a0d80ed8. <!-- sv: zoekt-adapter, incremental-equivalence, atomic-publication -->

Реализация новой Go поверхности — только после primitive baseline и конкретного
binding: paths/symbols/tests/dependencies/rollback. Первоначальные READ explorations
`/root/zoekt_m0`, `/root/fossil_m1` завершены; текущие implementation slices описаны
ниже. Независимый parent повторяет оракулы.

## Текущие grounded bindings M0/M1/M2

CONFIRMED ✓ Go primitive run `20261016T103710Z_3cb5d196`: marker
DAIS_GO_PRIMITIVE_42, exit 0. Host Go1.25.4 Windows/amd64, Zoekt toolchain
Go1.26.5 загружен штатным Go launcher. Fossil 2.28.
CONFIRMED ✓ Fossil SQL fixture `20261016T103934Z_25dd9513`: supported
`sql --no-repository --readonly -json REPO SQL`, files_of_checkin + hex(content)
вернули ожидаемые binary bytes и Unicode path; SHA256 репозитория не изменился.
Readonly write-control дал stderr "attempt to write a readonly database" при
exit 0 — обязательна проверка stderr, не одного exit. Предыдущие HARNESS
отказы сохранены: nested checkout без --nested и binary commit prompt без
--no-warnings/--no-prompt. Live repo этими probes не менялся.

CONFIRMED ✗ native Zoekt compile `20261016T104041Z_4679c5c1`: exit 1,
undefined unix.Umask (builder.go:1132/1133), NewIndexFile (merge/read).
Предыдущий `20261016T103753Z_55260337` остановился раньше на mixed Git/Fossil
VCS stamping; повтор использовал предложенный compiler `-buildvcs=false`.

- M1 binding: новый module `packages/dais-code-intelligence/go.mod`,
  `internal/fossil/**`; Provider.Head/Changes/ReadFile/ListFiles. Только stdlib,
  explicit HeadRef, full UUID, sha1/sha3 byte readback, delta endpoint maps.
  Test-first real Fossil fixtures, invalid revision/path/cancel/readonly controls.
  Исполнитель `/root/fossil_m1`, 35 calls/1200000 мс; без других путей и коммита.
- M2 portability prerequisite (STABILIZE): `experiments/2026-10-16_zoekt-fossil/windows-overlay/**`.
  Внешние исходники не менять. Byte-identical copy builder.go, затем manual
  apply_patch только Windows candidate: убрать unix import/init. Добавить
  indexfile_windows.go с readonly Win32 mapping. Go -overlay добавляет виртуальный
  файл к external checkout; отдельный probe module использует local replace.
  Baseline — указанный compiler FAIL; post oracle — настоящий build и text/delta
  search, bounded-read negative control. Linux не использует Windows overlay.
  После parent verification portability files могут войти в build tooling нового
  Go module (отдельный binding), не в external/.

CONFIRMED ✓ M0b частичный baseline `20261016T104235Z_3fe9d41d`: замороженный
SQLite snapshot SHA256 f963d60b24eab902fa5df7fee2d0fe423876095e4113c66893bdd0ee84858019,
6020 files / 83244 nodes / 399468 edges, 404934656 bytes. Reader измерил 30
повторов каждого structural SQL query. Это не fulltext/MCP/index_time/peak RSS
benchmark. M0b остаётся открытым на этих явно названных метриках; ускорение не заявлено.

M1 использует только стандартную библиотеку Go. Pure-Go SQLite driver
`modernc.org/sqlite v1.60.1` (registry source Go1.26.0, root downloaded toolchain1.26.5)
планируется исключительно для M2 derived publication metadata, не для чтения
Fossil blob.content и не как новая система памяти. До M2 mutation нужен binding.

### M2 adapter binding после probe

Candidate portability probe проверяет native build, full/delta/query и mmap;
parent rerun `20261016T104714Z_783708d5` PASS (exit0, bytes_dropped0, truncatedfalse)
независимо проверил тот же artifact, точные адреса, stale и bounds controls.
Windows retirement — upstream finalizer/GC, не синхронный Close. Не удалять
published/retained generations в foreground; старые shards сохраняются до
отдельного наблюдаемого retirement. Обход не выдаётся за repair upstream.

M2 source paths: `packages/dais-code-intelligence/internal/search/**`, go.mod/go.sum;
build tooling: `scripts/**`, `compat/zoekt/**` только внутри нового Go module.
`modernc.org/sqlite v1.60.1` хранит derived generations/current publication/files;
оригинальный SV/comment остаётся в Fossil, сохраняются только revision/SV refs.
Конфиг exclusions/max bytes сохраняет coverage. Candidate generation собирается
отдельно; delta копирует prior shards, MarkFileAsChangedOrRemoved/Add; после
проверок SQLite transaction CAS публикует generation. Ошибка/отмена сохраняет
прежнюю publication. Старые generations не удаляются под активным reader.
Search Request.Kind: code/regex/filename/symbol_text; символ-текст без ctags
не называется semantic definition/reference. Каждый result несёт full Fossil
revision, file artifact hash, path/line, index generation и исходный SV ref.
Оракулы — реальные Fossil A/B/no-op, full vs delta, exclusion, limit/cancel,
failed publication/reopen; false freshness predicate — EXPECTED_FAIL.

Нужное prerequisite M1 для real corpus: batch artifact reads по уже проверенным
manifest hashes, byte/hash verification и bounded SQL output. Это дополнительный
путь внутри `internal/fossil/**`, не read-time parent-chain и не новая память.
Публичные Head/Changes/ReadFile/ListFiles сохраняют исходный контракт.

Root CLI binding: `packages/dais-code-intelligence/cmd/dais-ci/**`;
сборка в module/dist, команды index/search/status, JSON results через тот же
search.Adapter. Никакого запуска daemon/install/MCP в этом binding. Направление
CLI: native-cli 0.45, revision-addresses 0.35, bounded-search 0.20.
Оракул — собранный executable на реальном Fossil fixture, включая EXPECTED_FAIL
для stale --expect-revision, пустого индекса и неверных аргументов.

## Намерение и границы

Запрос владельца: клонировать sourcegraph/zoekt и scip-code/scip в external/;
«очень хочу отвязаться от codegraph и чтобы было похоже на sourcegraph как в нашем
universal search и чтобы это было заведено на дифы фоссила с нашими SV».

Первый ограниченный проход: исходники, изолированный исполняемый эксперимент,
привязки миграции. Полная замена CodeGraph остаётся целью этого плана, пока
эквивалентность требуемых функций не проверена.

## Исторический execution envelope ревизии 1 — superseded ревизией 2

ALLOW на основании запроса: READ, PLAN_WRITE, MODIFY_CANDIDATE, EXTERNAL_EFFECT
(получение публичных исходников и зависимостей). Пути: external/zoekt,
external/scip, experiments/2026-10-16_zoekt-fossil/, соответствующий архив
experiments_history/, этот план, docs/README.md, _progress_log.md и generated
body plans/MASTER_PLAN.md. Не редактировать сторонние исходники, bin/ или
production consumers. Не запускать постоянные сервисы. Чужой dirty diff сохранить.
Инструменты: git, Go, Fossil, Python, cmd_runner, node_repl, apply_patch,
read-only CodeGraph и Universal Search. Бюджет прохода: 60 шагов, 90 tool calls,
5 возвратов, глубина 3, 1800000 мс. Независимый read-only explorer: 12 вызовов,
480000 мс, без записи и сервиса.

## Стратегия

Связь с MASTER_PLAN: continuity требует воспроизводимого состояния, адреса
изменённого дерева и доказуемых результатов. Fossil check-in/hash и SV обеспечивают
версионное происхождение поиска. Связанные планы: codegraph-impact-decoupling
(потребитель impact) и project-fossil-cell (SV/comments/mlink). Их задачи здесь
не закрываются по историческим отметкам.

## Критерии и Smoke Tests

1. Клоны: origin соответствует запрошенному URL без tracking query; HEAD читается;
   git status --porcelain пуст; fsck не находит повреждений. Негативный control:
   проверка отличает несуществующий git object от HEAD.
2. Zoekt: известный текст находится по file:line в обычном Fossil checkout без .git;
   отсутствующий sentinel не находится. После check-in изменённый, удалённый и
   переименованный файлы дают актуальные результаты, прежние значения отсутствуют.
3. Provenance: результат связан с Fossil check-in, blob hash, SV из event.comment;
   no-op SV check-in различим от текстового изменения. Произвольный A..B сравнивается
   по двум полным Fossil manifests, включая branch/merge/reverse, а не mtime.
   Этот механизм покрывает endpoint changes без предположения прямого parent mlink.
   Контроль — старый индекс не принимается
   за свежий после изменения дерева.
4. Архитектура: исходники и ограничения Zoekt/SCIP проверены; replacement seams
   указывают текущие символы/потребителей; отсутствие доказанного graph parity
   остаётся открытым. Ни build, ни text search не доказывают call graph.
5. Миграция: отдельные сравнительные оракулы search / definition / references /
   impact / SV/history / cancellation / unavailable. Production cutover только
   после parity на фиксированном корпусе; 5 млн сущностей — отдельный benchmark.

Предсказания: clone integrity PASS, неверный object EXPECTED_FAIL. Поиск fixture
до индекса — FAIL; после индекса — PASS. После изменения без индекса stale control
EXPECTED_FAIL; после переиндексации — PASS. Пока инструменты не квалифицированы,
их пробы diagnostic, не доказательство продукта.

## Задачи

- [x] Z1 — клонировать и проверить оба upstream checkout, записать HEAD и receipts.
  <!-- sv: source-acquisition, integrity, upstream-pins -->
- [x] Z2 — квалифицировать Zoekt build/index/query и Fossil diff/SV на изолированном fixture;
  сохранить команды, полные логи, реальные результаты и проигрывающие controls.
  <!-- sv: zoekt-search, fossil-diff, sv-provenance, differential-oracle -->
- [x] Z3 — записать grounded migration design с текущими consumers Universal Search/CodeGraph,
  Fossil/SV и ограничениями SCIP; независимый explorer и проверка источников родителем.
  <!-- sv: migration-seams, source-grounding, scip-navigation -->
- [ ] Z4 — реализовать локальный adapter/service и сравнительный oracle на реальном корпусе.
  Начать отдельным binding после Z2/Z3; production mutation вне первого envelope.
  <!-- sv: local-service, fossil-cursor, reproducible-parity -->
- [ ] Z5 — заменить CodeGraph consumers после проверенной parity; убрать обязательную зависимость,
  проверить critical flows, отмену, свежесть, отсутствие сервиса и rollback.
  <!-- sv: codegraph-migration, consumer-parity, regression -->

## Риски / rollback

- CONFIRMED ✓ Windows portability через pinned overlay, native compiled oracles
  20261016T160358Z_3673c425 / 20261016T160746Z_a0d80ed8. Linux runtime Unknown.
- Inferred: SCIP — формат, не готовый универсальный call graph. Проверить schema
  и indexer ownership до выбора graph модели.
- CONFIRMED ✓ full/delta equivalence на real Fossil fixtures; большие корпуса,
  delta/full timing ratio и disk retirement остаются Unknown. Старые generations
  сохраняются; synchronous Windows unmap не обещается.
- Inferred: mlink одного check-in не покрывает произвольный диапазон/ветви/undo.
  До production нужны ancestry и атомарная публикация индекса с revision cursor.
- Rollback первого прохода: остановить только свои процессы; удалить только
  собственные candidate artifacts при необходимости; runtime не меняется.

## Состояние доказательств

CONFIRMED ✓ git status: Local_Development, чужие dirty изменения присутствуют.
CONFIRMED ✓ fs.stat: external/zoekt и external/scip отсутствовали перед клонированием.
CONFIRMED ✓ git check-ignore: обе цели external и experiment исключены из Git.
CONFIRMED ✓ Z3: [отчёт и дизайн](../experiments_history/2026-10-16_zoekt-fossil/REPORT.md),
read-only explorer `/root/search_architecture`, независимое совпадение 7 source hashes
родителем. Review выявил повреждённую text diagram и 2 сокращённых адреса;
оба дефекта исправлены. Inventory — 6 швов, не полный список consumers.
CONFIRMED ✓ readonly SQLite: 496 check-ins, 272 signed на момент чтения,
последний signed check-in `cf64f467b5b2d6deed2bcb38d88740397a3dd32aa794f3f93a60f4bd5ca19b7a`,
полный SV и 3 mlink rows. Primitive control `absent_control` → EXPECTED_FAIL.
CONFIRMED ✓ первоначальные wrapper-вызовы были отклонены до запуска;
подробное основание не возвращено. Вывод о запрете самого cloning REFUTED:
обычный `git clone` через exec_command успешно создал оба checkout.
CONFIRMED ✓ Z1: Zoekt HEAD `74e1e85839697c4c4eb8a6223cc3971e6c26da45`,
SCIP HEAD `e26a0b0fc83424dbfe6c703c0437d4703aec4aa0`; origin совпадает с запросом,
git status --porcelain пуст, git fsck --full --no-reflogs exit 0 у обоих;
absent-path cat-file control exit 1 EXPECTED_FAIL.
[Receipts](../experiments_history/2026-10-16_zoekt-fossil/RECEIPTS.md).
Z1 закрыт; Z2 позднее закрыт native runtime receipts ниже. Настройки политик не менялись.

CONFIRMED ✓ independent parent 20261016T160250Z_3a37d7bc: четыре focused Go
packages PASS, canonical historical SV, точный serialized response bound,
ограниченный searcher cache, atomic failed publication/full-delta equivalence.
CONFIRMED ✓ native graph 20261016T160358Z_3673c425: 26 independent predicates;
shared metadata search+graph 20261016T160746Z_a0d80ed8: 11 predicates.
CONFIRMED ✓ _build.ps1 -Task build 20261016T160358Z_b3889489: exit0,
candidate dist, без promotion. [Evidence archive](../experiments_history/2026-10-16_dais-evidence-graph/REPORT.md).

## CLEAN_NEXT_STATE

План ACTIVE: Z1/Z2/Z3, M0a Windows/M1/M2 подтверждены своими receipts.
Первый исполняемый graph/evidence slice вынесен в completed child plan.
Следующий маршрут G1/G2: квалификация реального native SCIP producer и capture
входов, затем graph-query/MCP binding и сравнительный oracle на рабочем корпусе
(Z4), после parity consumer cutover (Z5). M0b остаётся частичным structural
baseline без index_time/RSS/fulltext parity/5M verdict. Continuation receipt:
20261016T160746Z_a0d80ed8 и заархивированный cli-final-report.json с fixture path.
Disk retirement и долговечная Fossil publication execution receipts — residual.
В рамках этого среза production consumers и bin/ не менялись; чужие concurrent
изменения в общем checkout сохранены. Whole-portfolio SUCCESS не установлен.
