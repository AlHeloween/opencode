# Raster viewport renderer

## Objective

Replace the native-graphics hybrid backend with a true raster viewport backend.
When raster mode is eligible, the terminal receives one RGBA viewport containing
text, borders, selection, cursor, images, diagrams, charts, and PDF fragments.
The existing hybrid renderer remains the default and fallback; ANSI cell output
is retained for terminals and screen modes where raster mode is ineligible.

The existing atomic-native-graphics work remains a transport foundation, but it
is not visual composition: ANSI cells and SIXEL are separate terminal layers.

## State Vector Manifest (SVM v2)

This is the compact, node-scoped execution state for this feature. Semantic
weights belong only to the node-local SV; work weights alone determine the root
progress. Evidence is immutable Git history or a reproducible oracle. Node IDs
are stable logical IDs until the project has an automated CHT writer; no
hand-authored digest is presented as a canonical CHT.

```mermaid
flowchart LR
  G["RVP/root\nUnified viewport"] --> E["E eligibility ✓"]
  G --> R["R composition ✓"]
  G --> O["O native output ✓"]
  G --> C["C raster caret ✓"]
  G --> T["T grapheme text → active"]
  G --> S["S UI styles pending"]
  G --> W["W direct WT oracle awaiting build"]
  G --> P["P bounds/backpressure pending"]
  G --> H["H native harness pending"]
  E --> R --> O --> W
  T --> S
  O --> P
  H --> W
```

| ID | Work wt. | Local SV / semantic dominant | State, evidence, and next admissible transition | Depends on |
|---|---:|---|---|---|
| `RVP/root` | 1.00 | `unified scene .40, scroll coherence .35, native graphics .25` / **One terminal scene** | Progress `0.50` derived from verified leaf weights. Next: accept verified leaf output only. | all children |
| `RVP/E` | 0.10 | `confirmed geometry .45, alternate screen .30, capabilities .25` / **Safe eligibility** | Done. Nonzero CSI pixel/cell metrics must exactly match logical columns/rows. Evidence: `b21a254da`. | — |
| `RVP/R` | 0.15 | `cell buffer .45, media patches .35, opaque RGBA .20` / **Final composition input** | Done for backgrounds, direct glyphs, media. Evidence: `3def96120`, `b21a254da`. | E |
| `RVP/O` | 0.15 | `one protocol image .50, no ANSI diff .35, lifecycle .15` / **Single native output** | Done. Raster branch bypasses ANSI diff; cleanup remembers its source protocol. Evidence: `b21a254da`, `14258c51f`. | E, R |
| `RVP/C` | 0.10 | `caret geometry .45, input usability .35, no ANSI restore .20` / **Raster caret** | Done. Block/line/underline are painted in the RGBA frame. Evidence: `a5adad714`. | O |
| `RVP/T` | 0.15 | `grapheme pool .45, Unicode sequence .35, cell metric .20` / **Text cluster fidelity** | Active. Pool UTF-8 now reaches the rasterizer; next: advance/shaping/fallback semantics. | R |
| `RVP/S` | 0.10 | `attributes .40, borders .35, selection/scrollbar .25` / **UI visual fidelity** | Pending. Starts after T has a stable glyph path. | T |
| `RVP/W` | 0.10 | `Windows Terminal .45, screenshot .35, resize/input .20` / **Direct observable oracle** | Awaiting full user build in a direct WT session; no code blocker. Required evidence: mixed text/Mermaid screenshot, typing, resize, clean exit. | O, C, H |
| `RVP/P` | 0.05 | `frame bounds .45, coalescing .30, transport latency .25` / **Bounded raster transport** | Pending. Must set pixel/byte/FPS limits before default enablement. | O |
| `RVP/H` | 0.10 | `native harness .50, deterministic pixels .30, CI oracle .20` / **Reproducible native proof** | Pending. A runnable Windows-compatible compositor oracle is needed before source-only assertions count as proof. | R, C |

The current execution frontier is `RVP/T`. `RVP/W` is deliberately independent
of Unicode/style implementation: it validates the already-complete single-frame
route, while T and S improve what that route paints. Failed diagnostics remain
scoped to their leaf and do not alter the root SV without an oracle-backed state
transition.

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

- [x] Define a `raster_viewport` render mode with explicit capability/config
  selection and eligibility gates: confirmed pixel/cell geometry,
  alternate-screen, no captured stdout, no split footer. Kitty/SIXEL can enable
  it; symbols, remote, and unsupported contexts retain the ANSI-cell backend.
  The opt-in is `rasterViewport: true` or `OPENTUI_RASTER_VIEWPORT=1`.
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
- [x] Rasterize the focused caret and hide the hardware cursor for raster
  frames. The direct path paints block/line/underline cursor geometry into the
  RGBA image and retains ordinary hardware-cursor semantics for the ANSI
  fallback. Scheduled blink invalidation remains a performance follow-up.
- [x] Change the native output path to replace one full viewport image without
  writing visual ANSI cells. Kitty deletes its image id; SIXEL performs an
  explicit full-viewport clear/repaint on the next frame after a mode change.
  The retained footprint records its emitting protocol, so it is cleared
  correctly across SIXEL/Kitty/symbol switches. The direct path owns one
  synchronized terminal frame and hides the hardware cursor. Resize/suspend/
  exit retention and a raster caret remain under the unchecked lifecycle task
  below.
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
