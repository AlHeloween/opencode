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

Продолжение 2026-10-17 «Респект. Продолжим!» закрывает второй ограниченный child:
[native producer/capture](../plans_completed/2026-10-17_dais-native-producer-capture.md).
Его native scip-go candidate, modern schema и capture проверены отдельными
runtime receipts; это ещё не production corpus или CodeGraph consumer parity.

Продолжение 2026-10-18 «Продолжай» закрывает
[навигацию и native MCP на рабочем корпусе](../plans_completed/2026-10-17_dais-navigation-mcp-corpus.md).
CONFIRMED ✓ независимые compiler/raw/wire oracles:33definitions/67references,
1270predicates в основном и архивном повторе. Это ограниченный Go cohort;
Z4/Z5 не закрываются как полная миграция языков/consumers/impact.
<!-- sv: native-mcp 0.40, compiler-oracle 0.35, versioned-navigation 0.25 -->

Продолжение «Ага, давай» закрывает
[прямые references диапазона Fossil](../plans_completed/2026-10-18_dais-fossil-reference-impact.md).
CONFIRMED ✓ native CLI/MCP и независимый raw/Fossil oracle:94witnesses рабочего
корпуса,26 контрольного,436/182predicates повторены из архива на fresh repos.
Это reference candidates с обоих концов, не call graph или consumer cutover.
<!-- sv: fossil-range 0.40, reference-impact 0.35, independent-oracle 0.25 -->

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
  **t135 addendum 2 (2026-10-22): class (b) — robot-finishable.** Next: the reproducible reader on the named corpus/query set (the M0b criteria 1-5 in ## Smoke Tests); the partial baseline `20261016T104235Z_3fe9d41d` (6020 files / 83244 nodes, structural only — no fulltext/MCP/index_time/peak-RSS) is the start, not the close. Z4/Z5 wait on it.
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

### M0b: новый ограниченный dispatch 2026-10-19

CONFIRMED ✓ исполнение Muse закончено: final msg_150980870001fPtnnpVd6h0EHY,
stop/time.completed1792353513972. Новый user после него — служебная L1 panel,
не новое owner задание. Событийный gap вынесен в
2026-10-19_codex-robot-event-handoff.md, эта задача M0b остаётся открытой.
Parent retained-evidence oracle:40 frozen source hashes и native binary hash
совпали; independent exact sets code26/symbol_text26/filename1/absent0,
изменённый expected set отвергнут. Receipt:
experiments/2026-10-19_dais-m0b-baseline/parent-retained-evidence.json.
Это проверка сохранённых данных, не новый backend replay. Read-only audit нашёл
неполноту проверок harness (subset/empty могли пройти), перезапись report aliases
при replay, SQL corpus query без path scope, неполные source dependency pins и
слишком широкий wrong-revision error control. До repairs criteria3/5 не приняты
как reusable oracle. Все четыре сохранённых CLI p95 превышают100ms; это CLI
end-to-end, отдельную latency Zoekt engine не измеряли. Ускорение не заявляется.

**Текущая модель после уточнения владельца:** opencode-go/muse-spark-1.3-contributor.
Владелец: «Ой блин перезапусти на muse 1.3 contributor» и
«GLM-5.3-Flash - палит деньги быстро никаких бюджетов не хватит».
Предыдущий GLM turn остановлен штатным abort: result=true, status idle,
unfinished tool calls0. Продолжение в той же session
ses_eaf755836ffed3AybbFykAPUz2 сохраняет candidate artifacts и исходный budget.
Первый новый assistant msg_15091b543001M7j7GtHfq02oYD реально использует
opencode-go/muse-spark-1.3-contributor; новый user
msg_15091b525001lFKTtxfXMMik3I содержит неизменный continuation brief.
Квитанции: abort-glm-receipt.json, muse-dispatch.json, muse-observation.json
в experiments/2026-10-19_dais-m0b-baseline/. Никакого fallback на GLM или другую
модель без нового решения владельца. Историческое описание первого запуска
ниже сохраняется как история; оно не задаёт текущую модель.

Владелец: «Окей отправляй робота на дело». ALLOW READ / PLAN_WRITE /
MODIFY_CANDIDATE для одного baseline среза; EXTERNAL_EFFECT только запрос к
существующему OpenCode host с явно выбранной моделью. Корневой budget этого
прохода:120steps/150calls/6returns/depth2/3600000ms; child резерв
80steps/100calls/4returns/depth1/2700000ms, без дальнейшего делегирования.
Binding: experiments/2026-10-19_dais-m0b-baseline/**; остальные project paths
read-only. Production consumers/service install/kernel/bin/external не входят.
Parent intention остаётся неизменным. Master strategy: повторяемый source-pinned
baseline уменьшает ошибку решения о Z4/Z5 и не закрывает их преждевременно.

CONFIRMED ✓ существующий codegraph-baseline.py прочитан; старый baseline — только
structural SQLite reader, source .codegraph/codegraph.db. Current host/provider
получены runtime API, не из старого порта. Muse Spark1.3 Free в выбранном Zen
catalog не обнаружен; платную Muse Spark не выбираем. Используется ранее
применявшийся разрешённый opencode-go/glm-5.3-flash с проверкой фактического
provider/model в первом assistant message.

До запуска product измерений предсказания: известный источник/контрольный запрос
возвращает известные данные; wrong revision/content hash/filter и изменённый
expected result дают EXPECTED_FAIL. Source mismatch между backend корпусами
должен запрещать сравнительный verdict, а не выдавать ускорение. Native fixture
qualification предшествует timed loop. Oracle: отдельный CLI replay сохранённого
кандидатного инструмента на новых owned outputs; parent исполняет независимо.
Index time/RSS/fulltext parity без наблюдения остаются unmeasured; весь M0b
нельзя закрывать по частичному reader PASS. Runtime oracle ещё не выполнен.

Task manifest: M0b, state=running, eta_turns=3, brief/reference
experiments/2026-10-19_dais-m0b-baseline/brief.md; dispatch и первый message
readback появятся в dispatch.json/observation.json того же каталога.
Continuation: наблюдение receipt → полный final/errors → независимый replay;
идентификатор исполнения не заменяется пометкой DONE. Связь с MASTER_PLAN
сохраняется через существующий parent, новая независимая программа не создаётся.

CONFIRMED ✓ dispatch readback: session ses_eaf755836ffed3AybbFykAPUz2,
user msg_1508aa807001l12JhKpsKcVRR6; первый assistant
msg_1508b2b530010sf75cQVAHbXvW: opencode-go/glm-5.3-flash, status busy.
Host nonce-qualified URL http://127.0.0.1:4096/, pid33424; credentials не сохранены.
Read-only explorer m0b_brief_review обнаружил недостаточный limit12 observation
и отсутствие first-assistant/user-text digest binding. Observer теперь читает
полный session API без limit, проверяет исходный user hash и фактическую первую
модель; first-response-receipt.json сохраняет readback. При завершении получить
полный collect-opencode report через scripts/codex-hooks/codex_hooks.py и
show-report; parent acceptance отдельно. Краткая observation не считается DONE.
Первый strict full-text hash check отказал: host добавляет UTC suffix и отдельные
synthetic CodeGraph/role/compact parts. Первичный text содержит исходный brief
неизменным префиксом; readback сохраняет raw digest, brief digest, наблюдённый
UTC suffix и число отдельных synthetic parts. Не выдавать эти digest за равные.

```yaml
Keywords: corpus-baseline 0.45, comparable-measurement 0.35, source-provenance 0.20
Semantic dominant: Проверить сопоставимость corpus/query и измерить baseline до замены потребителей.
md5: d6a04b725c3e49f1a85790eb2146cd38
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
note: hash values are generative tags — search them, never compute them.
```

План ACTIVE: Z1/Z2/Z3, M0a Windows/M1/M2 подтверждены своими receipts.
Первый исполняемый graph/evidence slice вынесен в completed child plan.
Native producer/capture child подтверждён archive replay 20261017T055638Z_6cfebbbf:
28 predicates, семь Go packages и mandatory build. Modern profile явно требует
UTF8 position encoding; official producer ambiguity сохранена как отказ, candidate
объявляет encoding до сериализации. Receipt не выдаётся за semantic correctness.
Повторный capture выделен в [завершённый child](../plans_completed/2026-10-17_dais-repeated-capture.md).
Его independent native oracle 20261017T104937Z_76d2dc79 прошёл47 predicates:
изменённый вызов Twice→Thrice, exact source/publication diffs, old graph STALE,
new graph PASS, third capture и refusal controls. Это полный reindex, не
incremental producer execution. Graph-query/MCP и рабочий Go-корпус теперь
подтверждены [отдельным child](../plans_completed/2026-10-17_dais-navigation-mcp-corpus.md):
archive replay20261017T200446Z_1e14a8db,1270predicates,10package regression и build.
Следующий маршрут G1/G2: отдельный truthful reference-impact contract для
SnapshotFossil.lastImpact и его downstream readers, затем parity/freshness/
cancellation/unavailable и consumer cutover (Z5). Инвентаризация семи capability
classes и прямой range oracle завершены отдельным child, но callerCount нельзя
подменять arbitrary references. Continuation receipt:20261017T235408Z_084d24a8
и20261017T235408Z_847baa14, reference-impact archive-replay/*.json.
M0b остаётся частичным structural
baseline без index_time/RSS/fulltext parity/5M verdict. Continuation receipt:
20261017T200446Z_1e14a8db и navigation-mcp wire-archive-replay/report.json;
исторический search oracle 20261016T160746Z_a0d80ed8 сохранён отдельно.
Disk retirement и долговечная Fossil publication execution receipts — residual.
В рамках этого среза production consumers и bin/ не менялись; чужие concurrent
изменения в общем checkout сохранены. Whole-portfolio SUCCESS не установлен.

### Новое поручение владельца 2026-10-20: продолжить базу знаний

CONFIRMED ✓ новый direct request: «Продолжим доделывать нашу базу знаний. Отправь робота».
Отдельный bounded continuation M0b, без смены цели и consumer cutover. Task SV
3a9c52f6b41847d0a25e90c781fd6be3, полный блок и прямой приказ:
experiments/2026-10-20_dais-resume/knowledge-{sv,order}.md.
Root envelope двух независимых заданий: READ/PLAN_WRITE, существующий OpenCode
host; candidate reader только experiments/2026-10-19_dais-m0b-baseline/**;
hook source — отдельный event plan. Root 120steps/220calls/4returns/depth1/
2400000ms с нового поручения; это новый внешний запрос, не reset старых runs.
M0b child reserve 60steps/70calls/3returns/900000ms с direct order.
Остальные old prohibitions сохраняются, model-only fallback запрещён.

CONFIRMED ✓ SV decode прочитан из actual MiniMax msg_1592ef93e001K6hVjKQ6pDndyO,
0tools; затем повторяющаяся init остановлена abort=true/status=null. Direct
order отправлен отдельно: session ses_ea6d1578affeocd5D1Cmd5vC3i,
anchor msg_b8575a06ca994db48fa84fbe0b14ca40. Receipt knowledge-order.json
sha256 8f73362049a6db4039178260a524c9101020d64f991290313f3694ee39370541.
Это квитанция отправки, не выполнения. Результат ожидается в knowledge-result.md/json;
независимая проверка другой моделью после freeze, M0b/Z4/Z5 остаются открыты.
Smoke prediction до ремонта: исторический воспроизводитель диагностический до
fresh classification; текущие existing controls должны сохраниться, внесённый
hash/revision/result mutant должен быть обнаружен. Нельзя закрывать недоступные
index_time/RSS метрики prose-отчётом. Следующий шаг — событийный terminal receipt,
затем raw artifacts/replay и независимый вердикт.

CONFIRMED ✓ bounded M0b continuation retained fresh run20261020T120914Z_afb296a3,
40files/40matched/0drifted/0missing; independent Muse report and full raw pytest
export under experiments/2026-10-20_dais-resume/verify-knowledge/. Reader unchanged
9021eb97...,15new testsRED/13oldPASS; implementation of5defect classes remains.
Freeze/result pins in knowledge-freeze.json. Saved verifier log was HARNESS failure;
parent recovered actual full ev_170d946a output with hash be550606d905ab587ab615f53285ee5c228a0c65d413e7dde3c1629526d6c2e5.
Do not claim whole M0b/parity/speedup. Next: minimal reader repair + independent
replay, source-pinned full logs and mandatory build. Callback experiment links to
event parent plan; actual native next request is pending, see parent-readback.md.
