# Полный YAML SV в Fossil

Закрытие перепроверено 2026-10-11: ✓ CONFIRMED (git show/status + SHA256) commit 6e3f386db1 содержит все восемь файлов задачи; четыре source/test пина ниже совпадают с текущими байтами. ✓ CONFIRMED (полный state/stdout cmd_runner 20261010T012320Z_bc83d96f): сборка через pwsh ConPTY завершилась exit0, smoke 10.0.1259 и embedded reasoning_prompt PASS, dropped0/truncatedfalse. Позднейшая запись о версии 10.0.1261 ниже — отдельное историческое свидетельство, не замена этого проверенного build stamp. ACTIVE и oracle pending в описании стартового envelope относились к началу работы; текущий статус CLOSED.

<!-- intention: в Fossil остаётся только адрес/сокращение SV, read-only ответы теряются -> полный существующий SV завершённого ответа читается из Fossil без OpenCode DB -->

```yaml
Keywords: fossil-roadmap 0.40, full-sv 0.30, empty-checkin 0.20, readback-oracle 0.10
Semantic dominant: Сохранить существующий YAML SV ответа в комментарии Fossil, включая ответы без файловых изменений.
md5: b78cfda0941e632aa0d3f67925b81c4e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Контракт

Статус CLOSED: S1–S3 подтверждены, реализация сохранена в commit 6e3f386db1b15d735f8a69cdd0e25a1040c03f5e. Explore-проверка плана и diff пройдена; её вывод — testimony, runtime oracle ниже.

G3 DRAFT -> G4 ALLOW: пользователь требует сохранения сообщений SV в Fossil. Эффекты: MODIFY_PROJECT, PLAN_WRITE, локальная сборка кандидата и scoped git commit; без promotion, внешней публикации, kernel/bin, чужих dirty hunks и изменения живой snapshot.fsl. Бюджеты: steps 120, tools 100, corrective loops 3, depth 2, time 1800000 ms. Корневой SVM: goal_hierarchy level 0, parent_turn_id null; acceptance ниже; oracle pending до измерений.

✓ CONFIRMED (CodeGraph + чтение source до изменения, red baseline): `memory/spine.ts:vectorSign` вызывается `session/processor.ts` на finish-step завершённого ответа; старый `snapshot/fossil.ts:track` принимал подпись, но без изменений возвращал прежний hash. Это исторический baseline, не описание текущего поведения.

## Задачи и oracle

- [x] S1: `src/memory/spine.ts:vectorSign` сохраняет собственный конечный YAML SV: Keywords с исходными весами, полный Semantic dominant, md5, prev-md5, parent-goal-md5. Старый префикс sv: остаётся. Фальсификатор: unit test возвращает сокращение, чужой цитированный блок, потерю цепи или придуманные поля. ✓ 2026-10-10: `test/memory/vector-sign.test.ts` — 4 теста (полный roadmap, свой вектор без чужой цитаты, отсутствующие поля не достраиваются, malformed не подписывается); свежий прогон 9 pass/0 fail на двух файлах (run `20261010T044432Z_967c1314`, exit0).
- [x] S2: `src/snapshot/fossil.ts:track` создаёт подписанный checkin даже без изменения дерева (`--allow-empty`); unsigned no-op сохраняет прежний hash. Фальсификатор: production service возвращает прежний hash для нового SV либо изменяет содержимое файлов. ✓ 2026-10-10: `test/snapshot/sv-roadmap.test.ts` — signed no-op даёт новый hash, unsigned возвращает прежний, snapshot:false отключает запись; тот же run `20261010T044432Z_967c1314` 9 pass/0 fail.
- [x] S3: реальный Fossil readback проверяет полный комментарий по полученному hash, prev-md5 следующей записи и восстановление файлов. Документ `docs/fossil-snapshot.md` описывает запись и чтение через `fossil info`/SQL, не file-content grep. Фальсификатор: в Fossil отсутствует хотя бы один ожидаемый атрибут либо checkout не возвращает файл. ✓ 2026-10-10: SQL-чтение комментария по hash + `fossil info` (все 5 полей) + `revertTo` возвращает v1 — sv-roadmap.test.ts test 1; prev-md5 цепочка (yaml2.prev=firstID) — test 2; док §2.0.1 описывает `fossil info HASH` и SQL через `fossil sql -R`, запрещая file-content grep (diff просмотрен, `docs/README.md` синхронизирован).

Bindings: существующий processor не меняется; unit harness Bun; integration harness `tmpdir`, `provideInstance`, `SnapshotFossil.defaultLayer`, реальный fossil, read-only SQLite readback его event/comment. Новые тесты `test/memory/vector-sign.test.ts`, `test/snapshot/sv-roadmap.test.ts`. SV направления каждого изменения — полный SV/trajectory/no-op persistence; никакое поле SVM/gate/depth/oracle не выдумывается из отсутствующих данных.

## Smoke Tests

Baseline: `bun test test/memory/spine.test.ts test/snapshot/snapshot.test.ts` из packages/opencode; прогноз PASS. Затем новые predicate tests на старом коде: полный YAML и signed no-op ожидаются FAIL, unsigned/absent-vector PASS. Post-change: те же focused tests + baseline regression + `bun typecheck`; прогноз PASS. Обязательный `_build.ps1 -Task build` после тестов; кандидат остаётся в dist, прогноз exit0. Cmd runner state и весь stdout читаются; crash/timeout = Unknown.

## Риски и границы

Read-only ответ создаёт дополнительный checkin с тем же деревом: намеренный эффект для дорожной карты. Это настоящий commit/скан дерева с существующей фоновой очередью и semaphore, а не бесплатная metadata-запись; исторические timing-комментарии не выдаются за свежий benchmark. Непосредственный parent→checkout diff такого шага пустой, lastImpact покажет 0 изменённых файлов. Без SV пустой checkin не создаётся; snapshot:false полностью отключает запись. Частичный SV с допустимым md5 сохраняет только реально написанные поля (отдельный тест); неизвестные/отсутствующие поля не достраиваются. Существующие сокращённые записи автоматически не мигрируются; новое поведение применяется при запуске нового runtime. Откат: scoped revert собственного commit; живые данные Fossil не изменяются тестами. Внешнее sync/publication не входит в задачу.

## Результат

✓ CONFIRMED (runtime): vectorSign дописывает полный собственный YAML, оба no-op возврата track обходятся только с sign, signed commit получает --allow-empty. Production processor не менялся. Actual diff: spine.ts, fossil.ts, два новых test файла, docs/fossil-snapshot.md и только Fossil строка docs/README.md; никакого live Fossil backfill.

✓ CONFIRMED (cmd_runner state + весь stdout): baseline 20261010T011406Z_1611f8dc exit0 — 75 PASS/6 SKIP/0 FAIL; новые predicates на старом source 20261010T011615Z_6c8e9761 exit1 — 2 PASS/7 ожидаемых FAIL. Full YAML/read-only hash доказан read-only Fossil SQLite, а затем fossil info. Post focused 20261010T011932Z_cd2c2409 exit0 — 11 PASS/0 FAIL/51 assertions; после child timeout и явного missing-parent assertion 20261010T012119Z_d83f08e9 exit0 — 9 PASS/0 FAIL/41 assertions. LastImpact regression проходил отдельно в первом post-run. Post baseline 20261010T011754Z_8802c5eb exit0 — 75 PASS/6 SKIP/0 FAIL/895 assertions. Эти шесть SKIP не считаются проверенным покрытием.

✓ CONFIRMED: bun typecheck 20261010T011704Z_92687b06 exit0; новые tests Prettier 20261010T012206Z_f5e52e43 exit0; YAML plans/docs прочитан PyYAML без ошибок. Git diff --check exit0. Все завершённые oracle логи: dropped0, truncatedfalse.

✗ REFUTED (Prettier): whole-file check spine.ts/fossil.ts красный и на HEAD, и на candidate. Это отдельный форматный residual вне runtime-acceptance; новых форматных исправлений в чужих участках не делалось. Raw PowerShell runner 20261010T012021Z_fc0e01f3 потерял output/exit и завершился health-check: Unknown, не build PASS. ConPTY честно показал parser FAIL Windows PowerShell 5 (20261010T012205Z_ed24d7ae): UTF-8 без BOM интерпретируется неверно. PowerShell 7 доступен; UTF-8/exit7 fixture 20261010T012247Z_7dfa5a53 дал точную контрольную строку и exit7, dropped0/truncatedfalse. Сборка повторяется с pwsh через квалифицированный ConPTY. Raw capture дефект не исправлен, обход записан как tool residual.

Пины SHA256 (файлы, не метки SV): spine.ts 595ca527b6164a2d486b29194571f24d90cc572f04217e8a0691c59e7a63db0d; fossil.ts af7cf53b3e6dff5e9b7acf85c97d7f56737b41a6e4e806e1b3fc84f56cdc5445; vector-sign.test.ts c1b30c630338d4b9eb710ecc7df2b396af8178a8b04321dece97c2d44a957b09; sv-roadmap.test.ts 1f92b560b5e642d9d1ce87afd1f9422f6118409cb4d1ca38357560f1d3063953.

✓ CONFIRMED (jobs.db cmd-4 status=done + dist/bin/opencode.exe 303029248 B @ 12:53:36): `_build.ps1` дошёл до «Build complete - artifacts in dist/» — последней строки Invoke-Build при $ErrorActionPreference=Stop; два внутренних smoke (10.0.1261 + reasoning_prompt embedded) прошли. Сборка шла мимо cmd_runner (pwsh — known tool), поэтому state.json нет; exit выведен из структуры скрипта (throw-пути не пройдены) и хвоста результата в jobs.db. План перенесён в plans_completed/, commit называет план. Неизменные residual: старые abbreviated SV не мигрируются автоматически; promotion в live runtime — owner's шаг; Prettier whole-file red на spine.ts/fossil.ts присутствует и на HEAD.
