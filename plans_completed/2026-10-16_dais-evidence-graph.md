<!-- intention: сведения о коде требуют повторного чтения и не несут проверяемого паспорта -> нативный версионный граф утверждений с адресуемым происхождением, результатами проверок и обнаружением устаревания -->
<!-- goal_sv: Keywords: evidence-graph 0.35, fossil-provenance 0.25, scip-projection 0.25, falsification 0.15
Semantic dominant: Проверяемый паспорт утверждения связывает SCIP, исходные артефакты Fossil и ограниченную область доказательства.
md5: f724b86091ac4d3eafe2685b017c94d2
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
-->

# DAIS: первый нативный граф утверждений и доказательств

Status: COMPLETE — bounded first executable slice, revision 1. Родитель: [Zoekt/SCIP/Fossil/SV](../plans/2026-10-16_zoekt-scip-fossil-sv.md).
Авторизация владельца: «Давай тогда делать это та игра которая стоит свеч» после
обсуждения паспортов утверждений, опровержений и обнаружения устаревания.
Нативный Windows обязателен; sc-machine, WSL и установка сервисов не входят в срез.

## Стратегия и граница результата

Вклад в MASTER_PLAN: агент получает проверяемые адреса исходников и результатов,
может продолжить работу после смены контекста и обнаружить потерю применимости.
Этот план закрывает первый исполняемый срез, родительский переход с CodeGraph
остаётся открытым. Нагрузочные 5 млн сущностей, межъязыковый resolver, call graph,
полная совместимость с OSTIS и переключение MCP consumers требуют своих оракулов.

CONFIRMED ✓ source-grounding: pinned SCIP e26a0b0fc83424dbfe6c703c0437d4703aec4aa0,
scip.proto SHA256 6795900ddf664f2fe12528b1b28eaf39fdf8c12707db1408a727cee83ea978c3;
pb.go SHA256 61179ef826a83046aea36226ab63fcd598e66d6c53702536eff5e5d73dd70307.
Исходная схема не хранит Fossil revision/document hash. Relationship flags
is_reference/is_implementation/is_type_definition не доказывают calls.
CONFIRMED ✓ parent oracle 20261016T154122Z_56437716: M1 tests PASS;
search HARNESS missing DAIS_TEST_FOSSIL. Повтор 20261016T154254Z_5e1ccdbb
выявил rename fixture и Windows mmap cleanup HARNESS failures; STABILIZE у zoekt_m0.
CodeGraph query новых evidencegraph/scipwire путей вернул нерелевантные INTERNAL
символы: это gap индекса. Прямое существование новых путей проверяется перед apply.

## Кандидаты и выбор

1. E1 identity/projection (SCIP schema, Inferred, tier 2): symbol namespace,
   local document scope, ordinal, roles, relationship flags; затем проверка потерь.
2. E2 immutable storage/provenance (Fossil Provider + SQLite, Inferred, tier 2):
   входы берутся из фиксированной версии, исторические снимки не перезаписываются.
3. E3 evidence/applicability (реальные A/B fixtures, Inferred, tier 2): runtime
   receipt относится к predicate, digest и набору входов; затем stale control.
4. E4 native CLI (существующий Go executable pattern, Inferred, tier 2):
   импорт, запрос, проверка и SCs export через воспроизводимый интерфейс.
5. E5 SCs projection (official SCs syntax, Inferred, tier 2): узлы/дуги/ссылки;
   полная совместимость sc-machine остаётся Unknown без его parser oracle.

SOURCE_STAMP E5: official_docs, https://ostis-ai.github.io/sc-machine/scs/scs/,
HTML SHA256 3a82f94abae95f5679dd47fca602b66c88a28f782e3e5ab9191cc66a4152dc53,
HTTP200, 77263 bytes; синтаксис triples/link/connector прочитан. Это source pin,
не выполненный parser oracle.

Медоиды E1/E2/E3 соответствуют независимым поверхностям schema/storage/runtime.
E4/E5 — потребители их результата, не дополнительные основания доказательства.

## Контракт первого среза

- Источник: tracked binary SCIP и tracked input-manifest в Fossil, canonical paths,
  full check-in UUID. Manifest явно задаёт SHA256 исходных файлов и SHA256 индекса.
  Привязка manifest доказывает совпадение заявленных bytes; она сама по себе не
  доказывает, что сторонний indexer действительно запускался или правильно разрешил символы.
- Проекция: symbols, occurrences и relationships с исходными roles/flags и ordinals;
  global identity сохраняет полный symbol, local identity ограничена document/index.
  Raw protobuf сохраняется без потерь, unsupported/invalid input не публикуется частично.
  Первый профиль dais-scip-utf8-v1 принимает только UTF8; UTF16/unknown schema
  проверяются как диагностированный refusal. Их реализация — residual, не partial complete.
- Derived SQLite namespace ci_graph_* в metadata.sqlite. Единственный первоисточник
  остаётся Fossil. Snapshot/assertion digest — SHA256 canonical versioned serialization,
  никогда SV md5. Повторный импорт идемпотентен; failed job сохраняет previous current.
- Verification: builtin instrument проверяет fidelity факта к исходному SCIP и
  координаты в привязанном исходнике. PASS относится только к этим predicates;
  semantic correctness стороннего indexer остаётся unknown. Произвольный JSON PASS
  не принимается как исполненная проверка. Receipt имеет собственный id и inputs digest.
- Applicability: сравнение ВСЕХ заявленных build-source inputs, включая зависимости,
  с target Fossil revision. Изменённая зависимость инвалидирует применимость даже
  при неизменном файле occurrence. FAIL/stale и история сохраняются.
- SCs export: явные сущности утверждений, связей, provenance и receipts; каждый
  экспорт указывает профиль, а непроверенная engine compatibility не называется PASS.

## Smoke Tests

До product edits: M1 enclosing baseline PASS указан выше; новая fixture test должна
упасть из-за отсутствующего graph API. SQLite primitive — настоящий create/read/rollback.
После: реальные Fossil A/B/no-op; binary protobuf; кириллица/emoji/CRLF; повтор local 0
в двух документах; package versions; combined flags; duplicate occurrences;
invalid/negative/out-of-range input; truncated protobuf; manifest/source mismatch;
dependency-only change; unchanged graph при новом SV; reopen/idempotence/cancel.
Предсказание: валидный импорт/verify PASS; каждый corrupt/stale/mismatch control
EXPECTED_FAIL без смены current. Historical A остаётся читаемым после B.
Независимый parent rerun + compiled CLI oracle, полные state/log и SHA256 receipts.
Проверка масштаба и скорости не входит в эти функциональные verdicts.

## Задачи и bindings

- [x] E1 — нативный импорт и граф с provenance/evidence, focused real tests.
  <!-- sv: scip-projection 0.40, fossil-provenance 0.35, evidence-graph 0.25 -->
- [x] E2 — отдельный dais-graph CLI и внешний oracle его compiled executable.
  <!-- sv: native-cli 0.40, falsification 0.35, revision-addresses 0.25 -->
- [x] E3 — документация, readback receipts, scoped commit, перенос этого плана.
  <!-- sv: continuation 0.35, reproducibility 0.35, evidence-graph 0.30 -->

ALLOW envelope revision 1: READ, PLAN_WRITE, MODIFY_PROJECT/MODIFY_CANDIDATE
только packages/dais-code-intelligence/**, этот план/родитель/MASTER_PLAN,
docs/dais-evidence-graph.md, docs/README.md (свои hunks), _progress_log.md (свои hunks),
experiments/2026-10-16_dais-evidence-graph/** и соответствующий experiments_history/.
Публичные Go dependencies разрешены; external/ не меняется. Generated SCIP binding
копируется byte-for-byte с source/hash/license readback отдельной проверяемой pipeline.
Штатный _build.ps1 разрешён без ForceBuild/promotion. Никаких bin/kernel/live-Fossil writes.
Бюджет этого авторизованного прохода: 160 шагов, 220 calls, 10 returns, depth 3,
3600000 ms; child reserves списываются из этого бюджета, не возобновляют его.
Rollback: удалить только новые candidate module paths/derived fixture databases;
historical Fossil и чужой dirty work не меняются.

SVM: root goal f724b86091ac4d3eafe2685b017c94d2; task E1. Parent e8a16f092bce49a5b9f4130dd7c26e84.
Binding E1: internal/evidencegraph/**, internal/scipwire/**, scripts/vendor-scip.ps1,
go.mod/go.sum. Binding E2: cmd/dais-graph/**. Tests before implementation.
Baseline/oracle vector: M1 PASS; graph pending. Evidence refresh owner: root.

CONFIRMED ✓ independent enclosing baseline 20261016T154639Z_82e27459:
exit0, full state/log read, dropped0/truncatedfalse; M1 12.982s, M2 2.379s.
CONFIRMED ✓ new CLI RED 20261016T154859Z_3e2e601b: missing run API, exit1.
READ ONLY review /root/fossil_m1: root active plan inventory linked, но три
плана без checklist и восемь nested files ещё не классифицированы; whole-portfolio
SUCCESS не установлен. Они не меняются этим path-bounded срезом.
E1 delegated /root/fossil_m1: 55 calls/1800000ms; API/Config зафиксированы в brief,
root owns E2 CLI, независимый oracle и final verification.

## CLEAN_NEXT_STATE

CONFIRMED ✓ parent package oracle 20261016T160250Z_3a37d7bc: exit0,
fossil/search/evidencegraph/graph CLI PASS; полные state/log readback.
CONFIRMED ✓ compiled native graph 20261016T160358Z_3673c425: 26 checks,
PASS/FAIL/STALE receipts; corrupted fact и dependency-only controls различаются.
Receipt содержит SHA256 реально исполнявшегося verifier; semantic_status unknown.
CONFIRMED ✓ shared search+graph CLI 20261016T160746Z_a0d80ed8: 11 checks.
CONFIRMED ✓ _build.ps1 20261016T160358Z_b3889489: exit0, candidate dist.
Документация docs/dais-evidence-graph.md; evidence archive
experiments_history/2026-10-16_dais-evidence-graph/REPORT.md + MANIFEST.json.
Критерии этого среза покрыты; full engine compatibility/real producer/scale не
присваиваются ему. Более широкий root goal остаётся ACTIVE, continuation —
родительский план и runtime receipt 20261016T160358Z_3673c425.
Исходные отказы сохранены в archive/runs. Scoped commit именует этот план;
после commit readback root проверяет пути/working tree. Whole-portfolio SUCCESS
не заявляется: не относящиеся к этому срезу gaps inventory описаны в отчёте.
