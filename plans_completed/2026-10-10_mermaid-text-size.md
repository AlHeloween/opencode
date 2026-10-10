# Mermaid: размер текста от терминальной ячейки

<!-- intention: текст диаграммы отличается по размеру от текста TUI и меняется с шириной окна -> размер букв соответствует терминальной ячейке, узкие схемы не растягиваются, широкие доступны горизонтальной прокруткой, высота свободна -->

Status: COMPLETE. Авторизация: «Давай» после предложения исправления, 2026-10-10.

Revision 2 (G6): read-only explore обнаружил повторный fit в OpenTUI. Добавляется существующий ImageRenderable.fit режим `none`: source pixels сохраняются при drawImage, cell box лишь резервирует место. Прежние fit/cover/fill не меняются. Envelope расширен на packages/opentui/packages/core/src/renderables/Image.ts и src/tests/image-natural-size.test.ts. Oracle: размеры drawImage в пикселях ТОЧНО равны source (допуск0), включая23×19 при ячейке12×20; scrollX=true, scrollY=false, child flexShrink0, последняя колонка доступна mouse-wheel вправо. На symbols fallback проверяем работоспособность, равенство букв там без физических pixels не объявляем.

```yaml
Keywords: fontmetrics 0.40, raster 0.30, viewport 0.20, regression 0.10
Semantic dominant: Один размер текста до раскладки, растеризация 1:1 и горизонтальный viewport для широких схем.
md5: 928b4f53ad106ce8f49207d65abc381e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 810e7ac263bd49f5a1e908d6cf742b30
```

## Основание и границы

✓ CONFIRMED (`20261010T122441Z_afc2509d`, полный log, exit0): maxWidth меняет высоту букв 11→22→44px, cellHeight не меняет RGBA. SHA исходника в experiments/2026-10-10_mermaid-render-audit/result.json.
✓ CONFIRMED (`20261010T143821Z_c83973f0`): baseline четырёх файлов 24 pass / 0 fail, bytes_dropped0, truncatedfalse.
✓ CONFIRMED (Windows Terminal Preview settings.json): defaults.font.face=Consolas; профили не переопределяют face.
✓ CONFIRMED (fontkit.create над consola.ttf): unitsPerEm2048, advanceWidth M/space1126. Высота ячейки не равна em; кегль привязывается к шагу моноширинных букв: cellWidth * unitsPerEm / advanceWidth.
✓ CONFIRMED (runtime144146/150210): themeVariables.fontSize задаётся до layout; шаг букв12/24 сохраняется при изменении длины схемы.

READ/PLAN_WRITE/MODIFY_PROJECT/MODIFY_CANDIDATE ALLOW; envelope: перечисленные ниже source/test, packages/opencode/package.json, bun.lock, docs/rendering.md, docs/README.md, этот план и _progress_log.md; build outputs dist/**, packages/opencode/dist/**, packages/opentui/**/dist/**; эксперименты и runner logs. Tools: CodeGraph, filesystem read, apply_patch, cmd_runner, Bun, _build.ps1, git scoped commit. Bounds: step_budget60, tool_budget100, loop_budget3, depth_budget2, time_budget_ms1800000. Запрещено: bin/** (кроме standing CodeGraph sync/status), kernel, SDK regeneration, full package tests, чужие dirty hunks. Сеть не требуется: зависимости уже в локальном Bun cache.

## Binding, claims и риски

- util/mermaid.ts: mermaidFontConfig/renderMermaidToSvg/ensureMermaidFont/renderMermaidToRgba/resetRendererCache. Повторно используем WASM fontSize и fontkit для метрик; не пишем новый парсер шрифта. Растр1:1, cache по source/theme/background/cellWidth. Удалены resvgOptionsForSvg и мёртвые входы raster fit budget.
- component/media-mermaid.tsx: передаёт измеренную ширину ячейки в layout.
- component/media-image.tsx: callback передаёт cellWidth; только diagram получает существующий OpenTUI scrollbox (ScrollBox.ts constructor:275–398), изображение остаётся своего размера. Attachments/video сохраняют текущую ветку.
- test/util/mermaid.test.ts и новый test/tui/mermaid-text-size.test.tsx: реальные WASM/resvg и Solid/OpenTUI, без подмены implementation.
- fontkit2.0.4 и @types/fontkit2.0.9 уже установлены транзитивно; объявляем прямые зависимости и обновляем lock штатно offline.

Falsifiers: glyph advance не равен cellWidth; размер букв меняется при другой длине схемы; изображение wide shrink-ится; последний узел недоступен прокруткой; tall ограничен высотой; mount/publish/attachment regression.
Риски: fontSize может быть молча проигнорирован; Yoga может уменьшить image; ceil cell box может масштабировать растр; cache может вернуть другой кегль. Каждый покрыт focused differential/визуальным readback. В текущем исправлении не меняем font-family discovery для других терминалов и не переписываем общий graphics protocol resolver.
Rollback: обратные scoped hunks; не восстанавливать whole dirty files из git.

## Задачи и Smoke Tests

- [x] T1. ✓ CONFIRMED (baseline143821, red144238/144556): новые predicates EXPECTED_FAIL на отсутствующем поведении.
- [x] T2. ✓ CONFIRMED (150210/150301): один контракт font metrics → Mermaid layout → raster1:1 → diagram scrollbox; predicates PASS.
- [x] T3. ✓ CONFIRMED (150210/150301/150300/150338): focused regressions, typecheck, _build.ps1, whole-frame visual readback и размеры при scroll.
- [x] T4. Документация и evidence readback готовы; архивный план включён в scoped commit, называющий этот путь. Commit proof: git log --all --grep=2026-10-10_mermaid-text-size.md.

Expected delta: существующие тесты EXACT-width superseded новой формулировкой пользователя; их удаление/замена с этой provenance, не waiver. Native attachments/publish unchanged. READY baseline записан выше. Исторический screenshot не доказывает запущенную версию; проверяем source и новый dist candidate.

IMPLEMENTATION_RESULT: Mermaid layout от measured cellWidth, natural resvg и fit=none, diagram horizontal viewport, reset font registry,3новых testfiles, прямыеfontkit dependencies, supersededexactwidthtests. ORACLE: PASS по source candidate. Residual продукта: установка в livebin требует отдельной команды владельца, вне авторизованного исправления; other terminal face discovery не менялся. Residual инструмента: raw PowerShell launcher orphan state, обход с guard остаётся отдельным дефектом cmd_runner.

✓ CONFIRMED (logs/cmd_runner/20261010T150338Z_9adfe5ad/{state.json,stdout_text.log}): build exit0,52400bytes,drops0,truncatedfalse,73sec; wholelog прочитан,518assetrows сведены вcount. OpenTUI dist пересобран, candidate10.0.1265 smokePASS. WarningsRustsyn иVitechunk/import сохранены. Livebin не затронут; generated tracked drift отсутствует поgitstatus. SHA256 источников/кандидата/логов закреплён в evidence.json рядом с visual fixture.

✓ CONFIRMED (20261010T150210Z_59a179b0): 49 pass /0 fail/152 assertions; полные logs, drops0/truncatedfalse. Wide40/80: source pixels неизменны, mouse wheel достигает последней колонки. TallTD больше20rows: внешний scroll открывает следующий текст. Symbols fallback проверяется по block glyph, не по тексту loading. ✓ CONFIRMED (20261010T150301Z_63b6e63a): Core65pass/0fail/360 assertions, включая23×19 exact pixels и штатные hitgrid fixtures. ✓ CONFIRMED (20261010T150300Z_4134abfe): typecheck exit0.

✓ CONFIRMED (live2.png + live-result.json, directWT145935): whole visible WT100×60, cell10×20, natural narrow264×216, wide960×81, tall124×371. Текст соответствует шагу TUI; wide viewport целиком виден как viewport, его край проверен отдельно input-test. Visual fixture использует actual core/renderMermaidToRgba, интеграция MediaMermaid проверена TUI-tests. Live bin не обновлялся. Проверенные JSON+README сохранены в experiments_history/2026-10-10_mermaid-text-size/ после contentcheck; PNG остается вscratch согласно archive.cjs exclusions.

✗ REFUTED (145516): reset оставлял метрики старого font registration в новомWASM; before widths108/156, after138.84/217.67. Исправлено сбросом registration/metrics; текущий reset differential PASS.
✗ REFUTED (145853/145920): scroll content оставался38cols при image137cols; explicit width не преодолел исходный maxWidth100%. Current binding задаёт width/minWidth/maxWidth единому cols().
Tool state: CodeGraph даёт source/impact, но anonymous test bodies не перечисляет — прочитаны как wholefiles. cmd_runner direct захват первой упавшей попытки показал только рамку, отвергнут; второй whole-window успешен. PowerShell direct runner -File/-Command оставлял orphan statusrunning безPID/вывода; квалифицированный Bun argv launcher печатает fixturePASS и childexit, build run150338. Это residual инструмента, не скрытая проверкаPASS. Prettier одно открытие media-image вернул UNKNOWN; seam отформатирован вручную, source прочитан и typecheckPASS.

✓ EXPECTED_FAIL (`20261010T144238Z_51330d2c`, exit1, полный log/drops0): три новых util predicates RED именно на отсутствующем cellWidth/layout1:1/cache-by-cellWidth. ✓ Font config differential `20261010T144146Z_91bf79ac` exit0: node width differential /4 =12 и24; квалификация исправлена после обнаруженного захвата stroke-width вместо width в scratch-сканере, false zero сохранён в предыдущем log. Новая probe имеет независимую assertion против fontkit metric.
