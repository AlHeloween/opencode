# Raster viewport renderer

## Objective

Replace the native-graphics hybrid backend with a true raster viewport backend.
When raster mode is eligible, the terminal receives one RGBA viewport containing
text, borders, selection, cursor, images, diagrams, charts, and PDF fragments.
The existing hybrid renderer remains the default and fallback; ANSI cell output
is retained for terminals and screen modes where raster mode is ineligible.

The existing atomic-native-graphics work remains a transport foundation, but it
is not visual composition: ANSI cells and SIXEL are separate terminal layers.

## Architecture

```mermaid
flowchart LR
  L["Solid layout and ScrollBox"] --> C["Cell buffer and pixel patches"]
  C --> S["Zig retained scene rasterizer"]
  S --> F["RGBA viewport: glyphs + UI + media + raster caret"]
  F --> P["one Kitty or SIXEL image"]
  P --> T["terminal"]
```

- The layout, hit grid, focus, keyboard input, and scroll state remain logical
  cell-space data; they are not reimplemented in the graphics backend.
- The rasterizer converts the final clipped `OptimizedBuffer` cell geometry and
  `PixelBuffer` into one viewport-size RGBA frame using confirmed terminal pixel
  resolution and confirmed cell width/height. Its drawable rectangle must agree
  with `columns × cell_width` and `rows × cell_height`, with an explicit crop
  policy for terminal padding/rounding. Never enable it on fallback 10×20
  metrics.
- Text rendering requires an embedded, pinned font stack: HarfBuzz shapes text;
  FreeType rasterizes hinted glyph bitmaps. Never guess an arbitrary host
  terminal font.
- The visible caret is rasterized into the viewport. The hardware terminal
  cursor remains hidden while the raster backend is active; a scheduled blink
  invalidator redraws it and is cancelled on fallback/shutdown.
- The backend sends one native image per accepted frame. No visible ANSI text
  is emitted on that backend.
- SIXEL frames are flattened to an opaque terminal-background RGB viewport.
  Retain and erase the previous viewport footprint before a shrink, resize,
  suspend/resume, or protocol/mode switch; transparency must never reveal stale
  native graphics.
- First implementation eligibility is alternate-screen only, without captured
  stdout or split-footer output. Main-screen scrollback and split-footer need a
  separate viewport/scrollback design.

## Prior art

- The existing OpenTUI Zig renderer already owns the final cell buffer,
  `PixelBuffer`, clipping state, and native Kitty/SIXEL encoders.
- HarfBuzz provides Unicode text shaping; FreeType provides hinted glyph bitmap
  rasterization. Use pinned source dependencies, not a system installation:
  https://github.com/harfbuzz/harfbuzz and
  https://freetype.org/developer.html.
- `zig-svg` remains useful for SVG assets but does not solve text shaping or
  glyph rasterization: https://github.com/vancluever/zig-svg.

## Implementation

- [ ] Define a `raster_viewport` render mode with explicit capability/config
  selection and eligibility gates: confirmed pixel/cell geometry,
  alternate-screen, no captured stdout, no split footer. Kitty/SIXEL can enable
  it; symbols, remote, and unsupported contexts retain the ANSI-cell backend.
- [x] Add pinned FreeType 2.14.3 and trusted bundled JetBrains Mono Regular
  bytes (SIL OFL 1.1) with a Zig `FontRasterizer` that exposes alpha glyph
  bitmaps. Native build passes on Windows.
- [ ] Extend the font subsystem with glyph cache, fallback chain, and
  deterministic cell metrics.
- [ ] Add shaping and glyph rasterization for every grapheme from the existing
  grapheme pool; consume `OptimizedBuffer` coordinates exactly, preserving
  wrapping, wide-cell continuations, combining marks, ZWJ emoji, CJK fallback,
  bold, italic, underline, strike, foreground, and background.
- [ ] Add a viewport RGBA compositor that paints cell backgrounds/borders,
  glyph alpha masks, selection, scrollbars, and `PixelBuffer` media in z-order;
  flatten the result against the terminal background before SIXEL encoding.
- [x] Add the initial Zig `RasterViewport`: it rasterizes final cell backgrounds,
  direct Unicode glyphs, and `PixelBuffer` media into one opaque RGBA viewport.
  Border/style/selection, grapheme shaping, fallback fonts, and terminal-output
  routing remain under the unchecked compositor/output work.
- [ ] Rasterize the focused caret and hide the hardware cursor for raster
  frames; schedule/cancel caret blink invalidation and retain ordinary
  hardware-cursor semantics for the ANSI fallback.
- [ ] Change the native output path to replace one full viewport image without
  writing visual ANSI cells. Kitty deletes its image id; SIXEL performs an
  explicit full-viewport clear/repaint on resize, suspend/resume, protocol
  switch, and exit. Restore the hardware cursor on fallback and shutdown.
- [ ] Add latest-frame coalescing and writer backpressure. Bound viewport pixels,
  palette size, encoded bytes, and raster FPS before raster mode can be enabled;
  dirty internal regions alone do not reduce a full SIXEL payload.
- [ ] Add a runnable native-test harness/CI command before treating Zig source
  tests as an oracle; Windows currently disables the Zig `test` step.
- [ ] Add direct Windows Terminal screenshots and input/scroll/resize tests for
  mixed Markdown and Mermaid/image fixtures first. Add chart and PDF-fragment
  producers before claiming their regression coverage.
- [ ] Measure RGBA composition, glyph-cache misses, SIXEL/Kitty encoding, and
  terminal-write latency. Establish a bounded frame-size and frame-rate policy.
- [ ] Add a logical-buffer copy-text command and test it in raster mode, so
  copy remains available when terminal text selection is intentionally absent.

## Compatibility decisions

- Native raster mode intentionally trades terminal text selection/copy semantics
  for pixel-accurate composition. Keep an explicit ANSI fallback and expose a
  copy-text command based on the logical cell buffer.
- The first production target is a bundled monospaced UI font. Matching every
  user's terminal font is impossible without an explicit font-file setting.
- Do not enable the mode by default until direct Windows Terminal smoke tests
  prove typing, caret blinking, selection, scrolling, resize, and clean exit.
- This plan owns only the new `raster_viewport` mode. The atomic-native-graphics
  plan continues to own hybrid transport/telemetry and remains its fallback;
  shared `renderer.zig` changes must preserve both modes explicitly.

## Smoke Tests

### Baseline [Exact]

- `bun run build:native:dev` (`packages/opentui/packages/core`): passes.
- `bun test src/tests/image-renderable.test.ts src/tests/renderer.image-protocol.test.ts`
  (`packages/opentui/packages/core`): 4 tests, 0 failures, 10 assertions.
- `bun typecheck` (`packages/opencode`): passes.
- `bun run build:native:dev` (`packages/opentui/packages/core`): passes after
  compiling the pinned FreeType dependency and embedded font subsystem.
- Direct Windows Terminal currently demonstrates the hybrid-layer defect with
  mixed text and Mermaid content; capture a reproducible cmd_runner screenshot
  before the first raster-backend edit.

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun run build:native:dev` (`packages/opentui/packages/core`) | native library compiles for Windows |
| 2 | runnable native-test harness (`packages/opentui/packages/core`) | glyph/media/caret compose into one opaque RGBA viewport; no visual ANSI payload |
| 3 | `bun typecheck` (`packages/opencode`) | TypeScript boundary remains valid |
| 4 | `_build.ps1` then cmd_runner direct WT (`repo root`) | mixed text/media scroll and resize as one image; typing and caret remain usable |
| 5 | screenshot regression fixtures | Mermaid, PNG, chart, and PDF fragment share one coordinate system |
| 6 | caret timing and copy-text tests | raster caret blinks without stale frames; logical text copy remains correct |
