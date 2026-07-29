# Atomic native graphics scene

## Context / goal

Native Sixel images are currently emitted as independent incremental pixel
patches. During a transcript scroll/reflow the text scene changes while old
Sixel planes can remain at obsolete terminal coordinates. The result is image
overlap and a non-graphical TUI.

Make native graphics a retained scene component: every scroll/reflow composes
the visible text cells and visible image planes as one terminal frame. Sixel
scrolling is enabled by default (DECSDM reset); Windows Terminal supports this
mode. The TUI must therefore preserve normal terminal semantics rather than
pinning independent image patches.

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

- [x] Add a native-graphics scene invalidation path: any pixel-plane geometry
  change, removal, or scroll/reflow forces one complete text-plus-graphics
  native frame rather than independent patch persistence.
- [x] Make `ImageRenderable` reject fully off-screen frames and clip partial
  frames; never clamp a negative image coordinate to row 1.
- [x] In the Sixel backend, clear stale plane regions before re-emitting the
  complete visible graphics scene, in the same synchronized frame as the text
  repaint; restore the active input cursor afterward.
- [ ] Replace Mermaid's PNG data-URL/Jimp decode handoff with direct Resvg RGBA
  frame delivery to `ImageRenderable`; add per-stage timing logs for Mermaid
  layout, rasterization, frame preparation, Sixel encoding, and write size.
- [ ] Add unit/native-protocol tests for scroll/reflow, off-screen culling,
  stale-plane clearing, and cursor restoration; build and capture a direct
  Windows Terminal screenshot after transcript scroll.

## Smoke Tests

### Baseline

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | existing image sizing and Mermaid tests pass | 24 pass, 0 fail, 57 expects |
| 2 | `bun test src/tests/renderer.image-protocol.test.ts` (`packages/opentui/packages/core`) | existing graphics capability test passes | 2 pass, 0 fail, 8 expects |
| 3 | direct WT test (`dist/bin/opencode.exe`) | reproduce Mermaid scroll/reflow without stale planes | pending |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | targeted OpenTUI Zig/TS image tests (`packages/opentui`) | full scene replacement clears stale Sixel output and restores input cursor |
| 2 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | direct RGBA pipeline preserves sizing and Mermaid rendering |
| 3 | `bun typecheck` (`packages/opencode`) | typecheck passes |
| 4 | `pwsh -File .\\_build.ps1` (repo root) then cmd_runner direct WT screenshot | visible text and diagrams move together through scroll; no overlap |

### Current validation [Exact]

- `bun run build:native:dev` (`packages/opentui/packages/core`) passes with the
  new Zig compositor.
- `bun test src/tests/image-renderable.test.ts src/tests/renderer.image-protocol.test.ts`
  (`packages/opentui/packages/core`) passes: 4 tests, 0 failures, 10 assertions.
- `bun typecheck` and `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts`
  (`packages/opencode`) pass: 24 tests, 0 failures, 57 assertions.
- Native Zig test execution is not currently exposed on Windows: the local
  `build.zig` deliberately disables its `test` step for Zig 0.15.2's
  `convertPathArg` crash. The production native library did compile successfully;
  the direct Windows Terminal oracle remains required.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [ ] Post-impl smoke passed before completion
