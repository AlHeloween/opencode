<!-- intention: "картинки/диаграммы не рисуются в новой dist-сборке" -> "вложения и mermaid снова видны в TUI" -->

# MediaImage: нулевой layout у `<image>` после re-base на OpenTUI 0.5.11

**Статус:** ACTIVE (2026-09-21)
**Владелец находки:** сессия `ses_f3d5f006dffe0015eRg1pBuKA2`
**Затронуто:** `packages/opencode/src/cli/cmd/tui/component/media-image.tsx`

## 1. Симптом (со слов владельца)

В dist-сборке (`dist/bin/opencode.exe`, версия **10.0.1057**) не отображаются:
- вставленный скриншот (виден только бейдж `img clipboard.png`);
- mermaid-диаграмма (`Вот тестовая диаграмма:` — и пустое поле).

Оба пути идут через один компонент — `MediaImage`.

## 2. Доказательства (Exact)

Рантайм-лог dist-бинаря, `dist/bin/.opencode/data/log/1789971997428_log_system_internal.jsonl`:

```
06:27:24  mermaid image pipeline selected            → detectedMode sixel / selectedMode sixel
06:27:24  mermaid: WASM loaded from B:/~BUN/root/mermaid_wasm_renderer_bg-…wasm
06:27:24  mermaid SVG rendered                       {svgChars:7166, elapsedMs:161}
06:27:26  mermaid SVG rasterized to RGBA             {outW:494, outH:792, outputBytes:1564992}
06:27:26  mermaid RGBA frame ready for native image
06:27:26  mermaid native image mounted               {imageWidth:494, imageHeight:792,
                                                      layoutWidth:0, layoutHeight:0}
```

Пейлоад того же кадра (`…062724.007.md`): `sixel: true`, `resolution 1500×800`,
`cellSize 10×20`, терминал `150×40`, `directCellGeometry: true`.

То есть **протокол есть, RGBA-кадр есть, элемент смонтирован — и его layout равен нулю**.

## 3. Причина (уточнена тестом; первая версия была неточной)

**Основной дефект — кадр не доходит до рендеребела.**
`createEffect` (`media-image.tsx:514-518`) читает зависимости в порядке
`!f || !imageRef || state() !== "native"`. В момент, когда кадр готов, элемента ещё нет:
эффект выходит на `!imageRef`, **не прочитав `state()`**, поэтому состояние не попадает в
трекинг и последующий `setState("native")` не перезапускает эффект. Ref-колбэк
монтирует элемент позже, но `setImage` уже никто не зовёт → у смонтированного `<image>`
`_image === null` → `renderSelf` выходит на первой же строке
(`Image.ts:184`: `!this._image || width <= 0 || height <= 0`).
Пользователь видит зарезервированные `minHeight` строки без пикселей, без спиннера
и без `[image unavailable]`: состояние `native`, ошибка не наступала.

Подтверждено падающим тестом: элемент найден, `width/height > 0`, а `image === null`
(см. §5, baseline).

**Второе требование, тоже отсутствовавшее** — явный размер бокса в клетках и контракт
пропсов 0.5.11:
1. у `ImageRenderable` **нет measure-функции** (`setMeasureFunc` во всём ядре зовут только
   `LineNumberRenderable` и `TextTable`), поэтому размер должен быть задан явно;
2. `ImageRenderableOptions = { source, fit, protocol, onLoad, onError }` (`Image.ts:12-18`);
   пропсов `data`/`imageWidth`/`imageHeight` в 0.5.11 **не существует** (grep по
   `packages/opentui`: ноль совпадений в исходниках) — reconciler присваивает незнакомый
   пропс как обычное JS-свойство (`reconciler.ts:348-353`), то есть молча в никуда;
   штатный вход — `setImage(data, w, h)` → `NativeImage.fromRgba` (`Image.ts:137-139`).

**Поправка к первой версии диагноза:** `layoutWidth: 0, layoutHeight: 0` в рантайм-трейсе
был **артефактом момента** — ref-колбэк читает размер до раскладки Yoga. Тест, читающий
размер после `renderOnce()`, показывает ненулевые `width/height` уже на сломанном коде.
Нулевой layout не был доказанной причиной и в правку как основание не вошёл.

## 4. Правка (`media-image.tsx`)

1. Кадр отдаётся рендеребелу **в ref-колбэке**, в момент создания элемента:
   `const current = frame(); if (current) r.setImage(current.data, current.width, current.height)`.
   Это единственная точка, где связь «число кадров → рендеребел» детерминирована и не
   зависит от порядка эффектов.
2. `<image>` получает явный размер в клетках:
   `width={nativeImageCellCols(f().width, cellPixelSize(...).cellWidth)}`,
   `height={nativeImageCellRows(f().height, cellPixelSize(...).cellHeight)}`.
3. Мёртвые пропсы `data`/`imageWidth`/`imageHeight` удалены — чтобы никто больше не
   считал их работающими.

Новый чистый помощник `nativeImageCellCols(imageWidth, cellWidth)` — зеркало
существующего `nativeImageCellRows`.

## 5. Smoke Tests — результаты

Файл: `packages/opencode/test/tui/media-image-native-layout.test.tsx` (монтирует реальный
`MediaImage` через `testRender` со всей обвязкой провайдеров).

**Baseline (до правки):** `1 fail`, `0 pass` — падение на `expect(images[0].image).not.toBeNull()`,
получено `null`. Инструмент умеет падать — требование @ORACLE выполнено.

**После правки:**
- тот же тест — PASS, вместе с символьной веткой (терминал без графики) — `2 pass`;
- `bun test test/tui/media-image-native-layout.test.tsx test/tui/media-image-size.test.ts`
  → **15 pass / 0 fail** (38 expect), run `20260921T063429Z_446ba201`;
- `bun typecheck` (`tsgo --noEmit`) в `packages/opencode` → **exit 0** (там же).

**Остаётся (шаг владельца):** пересборка и рендер-смок на бинаре — mermaid и вставленный
скриншот в TUI 10.0.1058+, проверка глазами/скриншотом.

### Живой смок на бинаре — сделан (2026-09-21 06:38-06:41Z)

Сборка: `_build.ps1` → exit 0, `[OK] Build complete`, `Smoke test passed: 10.0.1058`.
Запуск `dist\bin\opencode.exe --log-level DEBUG` через cmd_runner, в буфер положен тестовый
PNG (красно-синий + «SMOKE»), вставка `ctrl+v` в промпт, отправка.

- **Картинка рисуется** — владелец снял скриншот окна: изображение появилось (до правки
  на этом месте было пусто). Дефект закрыт.
- Ветка подтверждена логом: `DEBUG tui.media.image: "MediaImage: symbols path"
  {mode: "none", detectedMode: "none"}` — то есть это **символьная** ветка (полублоки,
  ≤80 колонок), а не пиксельная.
- Причина символьной ветки — сам терминал cmd_runner/ConPTY: он не заявляет ни sixel,
  ни kitty, ни разрешения (`mode: "none"`). Это не дефект рендера: пиксельный путь
  доступен там, где терминал отвечает (в прогоне владельца 06:27 в Windows Terminal caps
  были `sixel: true, resolution 1500×800, cellSize 10×20`, и mermaid ушёл в native).

**Что осталось доказать:** пиксельный (sixel) путь на бинаре 10.0.1058 — только в
терминале, который реально отвечает на запросы (окно владельца). Окно cmd_runner для этого
непригодно по определению.

### Закрыто владельцем

2026-09-21 06:43Z, владелец на бинаре 10.0.1058: **«Работает»**. Задача закрыта.

Остаточный риск, который этой правкой НЕ закрыт и вынесен отдельно: у медиа, смонтированного
до прихода ответа терминала на capability-запросы, `mode` фиксируется как `"none"` — такой
элемент рисуется полублоками до конца своей жизни. Лечится перезапросом режима по событию
`CliRenderEvents.CAPABILITIES`; в этот change set не входит. Без пересборки dist-бинарь
продолжает показывать старое поведение.

## 6. Остаточный риск

Первый прогон (06:15:50, тот же бинарь) имел `sixel: false`, `resolution: null` — там
`MediaImage` идёт по символьной ветке (`<code>`), и места тоже было не видно. Ветка покрыта
вторым тестом смока (стала зелёной на этой же правке), но на живом бинаре не проверена до
пересборки.
