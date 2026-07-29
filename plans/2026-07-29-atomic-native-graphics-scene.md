# Atomic native graphics scene

## Context / goal

Native Sixel images are currently emitted as independent incremental pixel
patches. During a transcript scroll/reflow the text scene changes while old
Sixel planes can remain at obsolete terminal coordinates. The result is image
overlap and a non-graphical TUI.

Make native graphics a retained scene component: every scroll/reflow composes
all visible image patches into one RGBA viewport canvas, emits exactly one
native graphics object, and restores the active input cursor in the same output
frame as the forced text repaint. The renderer must never issue one Sixel DCS
per diagram.

## Prior art

- Local: `ImageRenderable.renderPixels()` currently clamps a negative image
  position to row 1; `ScrollBoxRenderable` changes `content.translateY`.
- Local: `CliRenderer.render()` writes text first and only then emits native
  pixel patches, so the composition boundary is already centralized in
  `packages/opentui/packages/core/src/zig/renderer.zig`.
- External: DECSDM controls scrolling versus fixed-position Sixel graphics;
  Windows Terminal implements the scrolling mode. See
  https://vtdn.dev/docs/decset/mode80-decsdm/ and the VT340 graphics manual:
  https://vt100.net/docs/vt3xx-gp/chapter14.html
- Local asset: `packages/wasm/core/pkg/chafa.wasm` is embedded but has no active
  renderer binding. It is an encoder-quality oracle, not the compositor.

## Implementation

- [ ] Replace the per-patch native emission loop with one composited viewport
  canvas. Preserve transparent gaps so ANSI text between diagrams remains
  visible; use one Sixel DCS or Kitty image per invalidated frame.
- [ ] Keep raw patches only as retained scene inputs and derive one previous
  canvas footprint for clearing. Do not retain multiple terminal-native planes.
- [x] Make `ImageRenderable` reject fully off-screen frames and clip partial
  frames; never clamp a negative image coordinate to row 1.
- [ ] Clear the previous unified canvas, repaint text, emit the next unified
  canvas, then restore the input cursor as one renderer transaction.
- [x] Replace Mermaid's PNG data-URL/Jimp decode handoff with direct Resvg RGBA
  frame delivery to `ImageRenderable`; add per-stage timing logs for Mermaid
  layout, rasterization, and frame preparation. Native Sixel encoding/write
  telemetry remains a renderer follow-up.
- [ ] Add native Sixel encode/write timing to the renderer diagnostics.
- [ ] Add unit/native-protocol tests proving two images produce one native
  canvas/DCS, transparent text gaps survive, scrolling replaces one canvas,
  and cursor restoration remains correct.

## Smoke Tests

### Baseline

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | existing image sizing and Mermaid tests pass | 24 pass, 0 fail, 57 expects |
| 2 | `bun test src/tests/renderer.image-protocol.test.ts` (`packages/opentui/packages/core`) | existing graphics capability test passes | 2 pass, 0 fail, 8 expects |
| 3 | direct WT test (`dist/bin/opencode.exe`) | reproduce Mermaid scroll/reflow without stale planes | pending |

### Unified-canvas baseline [Exact]

- `bun test src/tests/image-renderable.test.ts src/tests/renderer.image-protocol.test.ts`
  (`packages/opentui/packages/core`): 4 tests, 0 failures, 10 assertions.
- `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts`
  (`packages/opencode`): 25 tests, 0 failures, 61 assertions.

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | targeted OpenTUI Zig/TS image tests (`packages/opentui`) | two diagrams compose into one Sixel canvas; text gaps and cursor survive |
| 2 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | direct RGBA pipeline preserves sizing and Mermaid rendering |
| 3 | `bun typecheck` (`packages/opencode`) | typecheck passes |
| 4 | `pwsh -File .\\_build.ps1` (repo root) then cmd_runner direct WT screenshot | visible text and diagrams move together through scroll; no overlap |

### Current validation [Exact]

- `bun run build:native:dev` (`packages/opentui/packages/core`) passed before
  the unified-canvas architecture correction; rerun is required afterward.
- `bun test src/tests/image-renderable.test.ts src/tests/renderer.image-protocol.test.ts`
  (`packages/opentui/packages/core`) passes: 4 tests, 0 failures, 10 assertions.
- `bun typecheck` and `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts`
  (`packages/opencode`) pass after the RGBA change: 12 Mermaid tests, 0 failures,
  30 assertions; the full earlier sizing-plus-Mermaid baseline was 24 tests,
  0 failures, 57 assertions.
- Native Zig test execution is not currently exposed on Windows: the local
  `build.zig` deliberately disables its `test` step for Zig 0.15.2's
  `convertPathArg` crash. The production native library did compile successfully;
  the direct Windows Terminal oracle remains required.
- Full product build completed with binary smoke test `10.0.685`. The legacy
  runner recorded exit `-1` after that successful output; the current runner's
  direct Windows Terminal capture is the authoritative graphics oracle.
- Direct Windows Terminal per-plane scene-recomposition capture (superseded by
  unified-canvas acceptance):
  `logs/cmd_runner/20260729T050306Z_bf5a5335/scene-recompose.png`. The image
  moved from row 3 to row 20 and no old Sixel plane remained.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Baseline for the original per-plane implementation recorded
- [x] Unified-canvas implementation only after its baseline
- [ ] Unified-canvas post-implementation smoke passed before completion
