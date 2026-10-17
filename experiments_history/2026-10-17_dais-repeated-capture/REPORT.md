<!-- sv: repeated-capture 0.40, fossil-diff 0.25, graph-freshness 0.20, falsification 0.15 -->
# DAIS: повторный native capture и свежесть графа

CONFIRMED ✓ независимый oracle20261017T104937Z_76d2dc79:47 predicates PASS.
CONFIRMED ✓ самостоятельный повтор из этого архива20261017T105055Z_cd1d9330:
тот же47-predicate контракт PASS, новые disposable revisions/scratch.
Два запуска реального native scip-go и третий контрольный повтор связывают
исходники Fossil с immutable SCIP/receipt/manifest. Для изменённого вызова
Twice→Thrice старый graph получает STALE; новый graph PASS, новая ссылка и
Unicode byte range подтверждены независимым Protobuf decoder. Raw SCIP export
побайтно совпадает; старый snapshot остаётся доступным после нового current.

## Механизм и граница

`--ref C` и `--previous-bundle-ref B` — отдельные full Fossil hashes. Ровно
три output paths должны существовать в обеих ревизиях с одинаковыми artifact
hashes. Prior receipt/manifest/raw index проверяются структурно: версии,
результат, declared index/source digests, exact manifest inputs, пути, aliases,
duplicate/unknown/trailing JSON и размеры. Только эти три пути исключаются из
materialization C. Обычный `ci/notes Ω.txt` остаётся входом и manifest dependency.

Новый receipt содержит direct previous-bundle revision + sorted artifact SHA256.
Цепочка receipts не обходится; третий запуск проверяет optional prior field.
Исходные B/C и старый bundle не меняются. Candidate bundle всегда новый; сам
capture ничего не публикует в live Fossil. Publication D выполнена только в
disposable oracle fixture. C→D меняет ровно3 paths, B→C — math.go/use.go.

Это полный reindex, не incremental execution. CAPTURED подтверждает исполнение
над declared inputs/configuration; semantic_status остаётся unknown. Проверка
чужого JSON не создаёт доверенной подписи или доказательства его автора.
External toolchain reads и descendants по-прежнему не являются sandbox boundary.
Graph/service/MCP/impact, corpus parity, Delphi/1С, p95/RSS/5M и CodeGraph cutover
остаются в родительском плане. SC-machine runtime не использовался.

## Оракулы и сохранённые отказы

- CONFIRMED ✓ baseline20261017T104303Z_8f85f53e: capture/CLI PASS.
- CONFIRMED ✓ missing-API RED20261017T104555Z_9561d157 сохранён.
- CONFIRMED ✓ ordered CLI RED20261017T104558Z_f7ca5afa:11 predicates прошли,
  затем отсутствующий --previous-bundle-ref отвергнут. Первая версия harness
  20261017T104524Z_bc5f978f остановилась после9 predicates на parsing пустой
  receipt неизвестного флага. Предикаты переупорядочены, исходный FAIL сохранён.
- CONFIRMED ✓ runtime20261017T104643Z_1125498b — HARNESS FAIL. Быстрые edits
  равного размера в disposable fixture пропущены по mtime; Fossil commit
  проверил checksum и отказал. Штатный `commit --hash` применён к fixture,
  полный rerun выполнен, assertions отказов не ослаблены.
- CONFIRMED ✓ agent suite20261017T104746Z_307c195f: positive repeat/third,
  обычный файл под output directory;18 новых negative subcases и23 прежних.
- CONFIRMED ✓ parent regression20261017T104913Z_a30059d7: семь explicit
  Go packages PASS, legacy/modern/search/fossil/capture/CLI. Полные logs/state
  удержаны, dropped0/truncatedfalse.
- CONFIRMED ✓ _build.ps1 -Task build20261017T105012Z_92c5a8a0 exit0,
  candidate dist smoke10.0.1421 и embedded prompt, lock released. Полный log
  прочитан: Rust syn future compatibility, WASM metadata и Vite chunk warnings;
  no failure. Shared-tree build не удостоверяет все concurrent изменения проекта.

Independent oracle дополнительно проверяет no-pin refusal, отсутствующий/неверный
previous publication, current-old-artifact mismatch, exact source/manifest hashes,
acyclic receipt, old/new SV/revisions, raw export и unchanged readonly repo bytes.
Это47 выполненных predicates, а не47 независимых источников истины.

## Воспроизведение

Собрать dais-capture.exe и dais-graph.exe по README модуля. Native producer —
квалифицированный scip-go v0.2.7 candidate из предыдущего capture-среза;
source pin/UTF8 patch и factory находятся в module compat/scip-go и scripts/.

`python <archive>/repeated_oracle.py --root <absolute repo> --goroot <native GOROOT>
--producer <pinned native executable> --report <caller-owned report.json>`.
Через cmd_runner, без WSL. Fixtures рядом со скриптом; новые Fossil/scratch/cache
директории создаются только под experiments/2026-10-17_dais-repeated-capture/.
Первичные test repositories и их admin configuration в archive не копируются.

MANIFEST.json закрепляет exact byte hashes source и archive. После commit
проверяются Git blobs. Чужие dirty/staged изменения общего checkout сохраняются.
CONFIRMED ✓ renderer20261017T105232Z_cd96ebfd: два одинаковых hashes,
gapsBefore[]. Native tools ответили полными state/log без dropped/truncated
output. Fossil fixture mtime issue устранён commit --hash и полным повтором.
Для commit reused квалифицированный private-index/hook/commit-tree/CAS route;
общий helper, заменяющий whole staged entry, не используется и не исправляется.
