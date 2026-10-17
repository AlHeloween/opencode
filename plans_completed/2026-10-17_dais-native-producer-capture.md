<!-- intention: граф принимает заявленный SCIP без свидетельства запуска -> нативный producer запускается над закреплённым Fossil-деревом и выдаёт проверяемый bundle для графа -->
<!-- goal_sv: Keywords: producer-capture 0.40, fossil-provenance 0.25, native-runtime 0.20, falsification 0.15
Semantic dominant: Реальный запуск индексатора связывает неизменные входы, исходный SCIP и проверяемую квитанцию.
md5: c2486fb91a504ed297db380f6ca15e73
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
-->

# DAIS: нативный producer и capture

Status: COMPLETE, revision 2 — ограниченный native producer/capture срез. Родитель: [Zoekt/SCIP/Fossil/SV](../plans/2026-10-16_zoekt-scip-fossil-sv.md).
Авторизация: «Респект. Продолжим!» после первого executable slice и указанного
следующего шага native SCIP producer/capture. Никаких WSL, контейнеров, live
Fossil writes, installed service, bin/ или переключения production consumers.

## Цель и критерии

Исходная ревизия A и опубликованная ревизия B различаются явно. Candidate capture
читает A только через readonly Provider, материализует отдельный workspace,
исполняет закреплённый native binary с явными argv/environment, сохраняет raw SCIP
без перекодирования. Receipt содержит source revision/input digest/index hash/
binary hash, configuration, результат и bounded diagnostics. Receipt не содержит
hash самого себя или финального manifest. Manifest включает source inputs и
receipt; отдельная fixture publication B добавляет ровно три output paths.

Workspace manifest не доказывает полноту фактических чтений инструмента. Первый
квалифицирующий корпус — offline Go module без внешних dependencies; GOROOT и
toolchain явно закреплены, сетевое module resolution выключено. Это исполнение
над заявленными входами/configuration, не sandbox и не общая semantic correctness.
Первый capture отвергает уже занятые output paths; repeated production capture
потребует отдельного контракта замены производных артефактов.

## Grounding / claims / risks

CONFIRMED ✓ enclosing baseline 20261017T053606Z_63ab25b4: четыре focused Go
packages PASS, полные state/log, dropped0/truncatedfalse. Первый diagnostic
20261017T053528Z_e414b96b сохранил HARNESS failure: search требует явного
DAIS_TEST_FOSSIL. Повтор задал native executable; source не менялся.
CONFIRMED ✓ go env 20261017T053557Z_62620f7c: Go1.26.5 Windows/amd64.
CONFIRMED ✓ explorer /root/plan_audit: 76 source/archive pins совпали; прошлый
child именован в коммите f29b14e5b63a9ec3b84983036ddd0d932fd798fb.
CodeGraph current source: Provider.Revision/ListFiles/ReadArtifacts и
Store.Import/inputs/project прочитаны; новый capture path отсутствует в module.

Стратегия MASTER: вместо восстановления факта исполнения из рассказа агента
передавать адресуемые артефакты и проверяемый переход A→B. Root parent ACTIVE.
Portfolio explorer: 37 root plans, три без checklist, один новый чужой plan ещё
не отражён в MASTER, восемь nested artifacts требуют квалификации. Это не
whole-portfolio closure; посторонние планы этим срезом не исправляются.

Кандидаты: native scip-go qualification; isolated materialization; bounded
process capture; acyclic receipt/manifest; independent CLI Fossil graph oracle.
Медоиды — producer source/runtime, immutable Fossil bytes, outside execution
oracle. Source/runtime unknowns не считаются Exact до воспроизведения.
Native schema incompatibility — отдельная наблюдаемая leaf, запрещено удалять
unknown protobuf fields, менять encoding декларативно или подменять raw index.
Окружение задаётся явным allowlist, inherited secrets в receipt не копируются.
Process bounds и source/binary before-after checks обязательны.

## Smoke Tests

До product edits: enclosing PASS выше; новый тест capture падает на отсутствующем
API. После: настоящий pinned indexer на маленьком Go корпусе с Unicode, definition
и reference; raw bytes/hash; A→B ровно три output files; import/verify/export и
source repository SHA неизменен при capture. Негативные controls: неправильный
binary hash, nonzero exit, timeout/output bound, отсутствующий/oversize index,
source mutation, path collision, receipt/index tampering. Ошибка не меняет current.
Предсказания: корректный capture и faithful graph PASS; controls EXPECTED_FAIL.
Непредсказанный runtime — diagnostic, классифицируется до повторного oracle.
Полные logs/state и исходные FAIL сохраняются в evidence archive; hashes читаются
из финального Git commit, `.gitattributes * -text` предотвращает EOL drift.

## Задачи

- [x] C1 — квалифицировать pinned native producer и границы schema/encoding.
  <!-- sv: native-producer 0.45, schema-compatibility 0.30, toolchain 0.25 -->
- [x] C1b — отдельный modern SCIP UTF8 профиль, без потерь и изменения legacy.
  <!-- sv: schema-compatibility 0.45, lossless-projection 0.35, regression 0.20 -->
- [x] C2 — isolated capture API/CLI, immutable raw output, receipt/manifest.
  <!-- sv: producer-capture 0.45, fossil-provenance 0.35, bounds 0.20 -->
- [x] C3 — независимый real producer → Fossil → graph oracle, документация/commit.
  <!-- sv: independent-oracle 0.45, graph-applicability 0.30, reproducibility 0.25 -->

## ALLOW / bindings

User authority выше + full-access runtime. Classes READ, PLAN_WRITE,
MODIFY_CANDIDATE, MODIFY_PROJECT, EXTERNAL_EFFECT (публичный producer/dependencies).
Paths: packages/dais-code-intelligence/** (кроме неизменного pinned scipwire при
отсутствии отдельного schema binding), этот plan/parent/MASTER/_progress_log,
docs/dais-evidence-graph.md, experiments/2026-10-17_dais-producer-capture/** и
соответствующий experiments_history/**. Получение producer в собственный scratch
toolchain directory, не глобальная установка. Existing external clones неизменны.
Штатный _build.ps1 -Task build разрешён без ForceBuild/promotion.
Bounds: 160 steps, 220 tool calls, 10 returns, depth3, 5400000ms от начала прохода.
READ explorer reservations: producer_grounding 15calls/480000ms, plan_audit
15calls/480000ms; implementation получает остаток, бюджет не возобновляется.

C2 binding: internal/capture/** и cmd/dais-capture/**; reused Provider. Новый
immutable export bundle — artifact, не runtime JSON state store. Его создание
не публикует Fossil и не меняет graph current. Shared graph/store/provider
изменяются только после отдельного impact binding при подтверждённой нужде.
CONFIRMED ✓ native producer v0.2.7 acquisition 20261017T053934Z_c4f6469f exit0;
реальное индексирование 20261017T054016Z_8d942cee exit0, 1187 bytes. Schema probe
20261017T054043Z_ce2fdf00: legacy importer exit1, unsupported unknown protobuf
fields in scip.Occurrence; repository SHA unchanged. Это наблюдаемый G8→G2 split,
не разрешение удалить поле. READ-only producer_grounding не стартовал (pending_init),
root выполнил квалификацию и сохранил реальные run receipts.
C1b binding: новый internal/scipmodern/** с private descriptor registry pinned
official github.com/scip-code/scip/bindings/go/scip v0.7.1 (зависимость producer),
internal/evidencegraph/project_modern.go, project_modern_test.go/testdata,
ProfileModernUTF8 constant в types.go, profile allow в Open/store.go и dispatch
в project.go. Legacy scipwire byte identity неизменна. Descriptor создаётся
проверяемой standalone Go pipeline, сохраняет upstream package/type/field identity,
не регистрируется глобально рядом с legacy messages. Все известные новые поля
остаются в fact payload/raw index; неизвестные по pinned schema по-прежнему отказ.
UTF16/UTF32 position profiles не подменяются UTF8; отдельно diagnostic refusal.
Внешние source clones не меняются. Runtime oracle нового профиля — настоящий
SCIP fixture; legacy suite должен остаться PASS. Root повторяет оба.
Дополнительный source-grounded C1 binding: scripts/build-scip-go.ps1 и
compat/scip-go/position-encoding.patch. Official v0.2.7 не задаёт Document encoding;
strict modern profile обоснованно отказал (054518Z_ddfe4b69). Reviewed patch
добавляет explicitUTF8 в producer ДО сериализации. Go запретил overlay внутри
GOMODCACHE (054803Z_936f45a1); pipeline проверяет полный source tree, копирует
129 files/399003 bytes в bounded scratch, применяет patch, строит candidate и
повторно хеширует неизменённый original. Неполное дерево отвергнуто до staging:
20261017T055244Z_5a6b3a6f EXPECTED_FAIL. Это отдельная candidate-сборка, её pin
есть в execution receipt; rawofficial index сохранён как отрицательный control.
Rollback: только собственные новые module/candidate paths; evidence failures
сохраняются. Test fixtures — caller-owned disposable dirs; live Fossil readonly.

## CLEAN_NEXT_STATE

CONFIRMED ✓ parent focused regression 20261017T055220Z_130d2c50: семь packages
PASS, legacy и modern, полный log/state без потерь. Capture deadline repair:
runtime RED 054255Z_50e1cf24, PASS 054328Z_fbaab13f и parent rerun.
CONFIRMED ✓ independent archive replay 20261017T055638Z_6cfebbbf: 28 predicates
PASS, реальные executable/Fossil/Unicode golden references, raw identity,
перечень A→B exactly3, source readonly, negative controls и previous current.
CONFIRMED ✓ _build.ps1 20261017T055327Z_fee29dd1 exit0, dist candidate,
version smoke10.0.1419, lock released. Report/whole logs/manifest:
experiments_history/2026-10-17_dais-producer-capture/REPORT.md.
Source implementation: /root/capture_core и /root/modern_profile, parent прошёл
собственные оракулы. Внешний producer_grounding не стартовал, замена — root.
Проверенный child переносится в plans_completed/ и scoped commit именует план.
Root ACTIVE. Следующий маршрут G1: repeated capture изменившейся source revision
с reserved-output replacement contract, рабочий corpus, затем graph/MCP binding.
Continuation receipt: 20261017T055638Z_6cfebbbf + archive-replay-report.json.
Root residual: production corpus/MCP/impact/parity/CodeGraph cutover, 5M/p95/RSS,
Delphi/1С resolver, full SC-machine parser compatibility.
