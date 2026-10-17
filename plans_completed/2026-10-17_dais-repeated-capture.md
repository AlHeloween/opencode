<!-- intention: capture отказывает ревизии с предыдущими ci outputs -> изменённая Fossil revision получает новый native capture с явной проверкой заменяемого bundle и независимым diff/graph oracle -->
<!-- goal_sv: Keywords: repeated-capture 0.40, fossil-diff 0.25, provenance 0.20, falsification 0.15
Semantic dominant: Повторная индексация меняет только проверенный предыдущий bundle и сохраняет адреса исходных ревизий.
md5: b5193e80a7c24b69a02f7e345c1d986b
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e8a16f092bce49a5b9f4130dd7c26e84
-->
# DAIS: повторный native capture

Status: COMPLETE, revision 3 — bounded repeated capture. Parent: [Zoekt/SCIP/Fossil/SV](../plans/2026-10-16_zoekt-scip-fossil-sv.md).
User authority: «Продолжай», после завершённого e02093cf native producer/capture.

## Intention / SVM / bounds

Root goal остаётся Fossil-native code intelligence с SV и проверенной заменой
CodeGraph consumers. Этот child закрывает только repeated capture на малом Go
корпусе. SVM: turn repeated-capture-01, parent producer-capture-01; task R1 active,
R2/R3 pending; eta_turns 1; own oracle receipts ниже. Production migration,
installed service, kernel, bin/, внешние источники и live Fossil writes исключены.
ALLOW: READ, PLAN_WRITE, MODIFY_PROJECT, MODIFY_CANDIDATE; paths module
packages/dais-code-intelligence/**, этот child/parent/MASTER/_progress_log,
docs/dais-evidence-graph.md, experiments/2026-10-17_dais-repeated-capture/** и
одноимённый experiments_history/**. Root bounds 160 steps/180 calls/8 returns/
depth3/3600000ms от 2026-10-17T10:43Z; implementation child reserves45calls/1200000ms.
No install/push/promotion. _build.ps1 -Task build после scoped tests обязателен.

## Grounding / strategy / claims

CONFIRMED ✓ e02093cf commit receipt:164 Git blob pins; чужой staged delta15
records сохранён. Runtime baseline 20261017T104303Z_8f85f53e: capture и CLI PASS,
exit0/dropped0/truncatedfalse. CodeGraph current capture.Run:252–285 отвергает
любое source/output overlap; Provider.ListFiles/ReadArtifacts readonly, consumers
Store и search.Adapter не меняются. CLI run конкретно прочитан с текущего диска.
Falsifier нового эффекта: штатный повтор на C с прежним bundle B должен сейчас
отказывать; после R1 он проходит только с явным pinned previous B.

Стратегия master goal: runtime proof изменения версий заменяет предположение о
свежести графа; ребёнок предыдущего capture среза, не новый search backend.
Существующий portfolio имеет чужие открытые планы/неполные vectors; whole-portfolio
closure здесь не заявляется. Read-only explorer проверяет scoped links/pins/boxes.

Кандидаты: явный previous publication pin; проверка трёх old artifact hashes;
материализация C без этих outputs; provenance в новом receipt; независимый
Fossil diff + stale/new graph oracle. Все tier2/Inferred по текущему механизму,
до smoke не Exact. Центральные оси: immutable Fossil source, bounded native
execution и independently decoded SCIP. Следствие: graph current меняется только
после штатного успешного import нового bundle, failed capture его не касается.

## Контракт R1

Config.PreviousBundleRevision / --previous-bundle-ref — необязательный полный
Fossil hash B, а --ref C — отдельно полный source check-in. Default поведение
не меняется: collisions отказ. При opt-in только ровно три заданных output paths
могут быть исключены из materialization, только если все присутствуют в C и B,
их immutable content hashes совпадают, paths regular/nonalias, bundle структурно
согласован. Прочие overlaps всегда отказ, никакого directory-wide exclusion.

Согласованность B: receipt v1/CAPTURED/exit0/semantic_status unknown, валидные
source revision/index/input digests; manifest v1, index hash совпадает с raw SCIP
и receipt; manifest inputs ровно receipt source inputs + raw receipt hash,
без index/manifest/self references, duplicates/alias/unsafe paths. Source-input
digest проверяется canonical existing serialization. Все reads/counts/bytes
под existing positive bounds/deadline. B не превращается в trusted signature
или semantic PASS; схема допускает сторонний JSON только как заявленные данные.

Новый receipt содержит direct previous-bundle revision + hashes трёх артефактов,
без рекурсивного обхода цепочки. SourceInputs содержат полный C минус ровно три
проверенных outputs; обычные файлы, даже под ci/, остаются source inputs.
Manifest остаётся acyclic: новые sources + новый receipt. Исходные B/C, старый
bundle, old graph snapshot сохраняются. Capture остаётся full reindex, не
инкрементальное исполнение producer и не live Fossil publication.

## Smoke Tests / acceptance frame

Предсказания до edits: focused baseline PASS; новый тест повторного capture RED
на отсутствующей возможности, затем PASS. Controls EXPECTED_FAIL: no pin,
invalid/missing prior ref, partial/malformed bundle, mismatched current old
artifact, case/prefix collision, wrong manifest/receipt/index/input digest,
extra ordinary ci file must remain input. Неуспех не публикует candidate.

Независимый oracle (Python + реальные CLI/Fossil/scip-go): A→capture→B; source
edit changes call Twice→Thrice + add definition→C; ordinary capture C refuses;
opt-in C/B produces new bundle→D. Fossil C→D меняет ровно3 artifact paths;
B→C source diff соответствует fixture. Старый graph на C STALE, новый D PASS;
raw SCIP отдельно decode показывает новую ссылку и отсутствие прежней ссылки в
изменённом Use, UTF8 byte ranges сохранены; raw export byte identity. Failed
replacement current сохраняет. Repository bytes readonly по capture/import/verify.
Третий capture D/D принимается с direct previous bundle: прежний optional field
не ломает повтор и не вызывает рекурсивный обход; source inputs остаются прежними.
No semantic correctness claim beyond golden fixture.

## Задачи / bindings

- [x] R1 — explicit previous bundle replacement, receipt provenance, tests и CLI.
  <!-- sv: repeated-capture 0.50, provenance 0.30, refusal-controls 0.20 -->
  Paths: internal/capture/**, cmd/dais-capture/** only; reuse Provider and same
  input/manifest/atomic publication. Agent выполняет tests first, parent reruns.
- [x] R2 — independent native repeated-capture/Fossil-diff/graph oracle.
  <!-- sv: independent-oracle 0.45, fossil-diff 0.30, graph-freshness 0.25 -->
  Paths: experiments/2026-10-17_dais-repeated-capture/**; исходный oracle и pinned
  native producer прошлого среза reused. RED/FAIL history не переписывается.
- [x] R3 — archive/pins, docs, scoped review, build, renderer и named commit.
  <!-- sv: evidence-archive 0.40, clean-state 0.35, continuation 0.25 -->

## Risks / rollback / continuation

Risk: silent source omission → exact3 hashes/paths gate + ordinary ci file oracle.
Risk: forged old receipt → structural-only qualification explicitly stated, no
trust promotion. Risk: recursive lineage cost → direct previous binding only.
Rollback: own new flag/receipt field/helper/tests, no external cache/source edit.
CONFIRMED ✓ R1 missing-API RED 20261017T104555Z_9561d157. Independent old CLI
RED 20261017T104558Z_f7ca5afa:11 predicates before absent flag, including actual
old snapshot STALE on changed C; initial diagnostic 104524Z_bc5f978f retained9
checks then receipt parsing of unknown CLI flag (HARNESS ordering improved).
CONFIRMED ✓ R1 full rerun 20261017T104746Z_307c195f exit0, no dropped/truncated
output. Original runtime 20261017T104643Z_1125498b retained HARNESS failure;
same-size fixture edits fixed with Fossil --hash. Independent parent regression
20261017T104913Z_a30059d7: seven named Go packages PASS, full log read.
CONFIRMED ✓ R2 native CLI 20261017T104937Z_76d2dc79:47 predicates PASS,
actual producer/Fossil/graph, source change and exact3 publication, old STALE,
new PASS, third capture, Unicode byte range, retained failures/current/old export.
CONFIRMED ✓ R3 archive replay20261017T105055Z_cd1d9330:47 predicates PASS,
fresh revisions. _build.ps1 run20261017T105012Z_92c5a8a0 exit0, smoke10.0.1421,
candidate dist, lock released. Full raw log retained; warnings Rust syn future
compatibility/WASM metadata/Vite chunks, no build failure. No installation.
Read-only portfolio review confirmed37 root plans/all mapped,3 without checklist;
existing vector/manifests debt retained, no whole-portfolio PASS. Final scoped
archive pins reviewed separately, parent rechecks committed blobs before closure.
Child moves to plans_completed; named scoped commit preserves foreign index.
CONFIRMED ✓ final renderer20261017T105232Z_cd96ebfd: два одинаковых hashes,
gapsBefore[]; после concurrent plan closures35 active source documents/144 open
boxes. Это проверка карты, не подтверждение чужих completion claims.
Continuation: archive-replay-report.json + run20261017T105055Z_cd1d9330.
Root residual remains corpus/MCP/impact/parity/performance/CodeGraph cutover.
