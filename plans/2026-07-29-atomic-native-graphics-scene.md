# Atomic native graphics scene

## Context / goal

Before the unified-scene change, native Sixel images were emitted as independent
incremental pixel patches. During a transcript scroll/reflow the text scene
changed while old
Sixel planes can remain at obsolete terminal coordinates. The result is image
overlap and a non-graphical TUI.

Make native graphics a retained scene component: every scroll/reflow composes
the visible image patches supplied by the clipped layout into one RGBA scene
bounding box, emits exactly one
native graphics object, and restores the active input cursor in the same output
frame as the forced text repaint. The renderer must never issue one Sixel DCS
per diagram.

## Prior art

- Historical local baseline: `ImageRenderable.renderPixels()` clamped a
  negative image position to row 1; `ScrollBoxRenderable` changes
  `content.translateY`.
- Historical local baseline: `CliRenderer.render()` wrote text first and only
  then emitted native pixel patches. The composition boundary is centralized in
  `packages/opentui/packages/core/src/zig/renderer.zig`.
- External: DECSDM controls scrolling versus fixed-position Sixel graphics;
  Windows Terminal implements the scrolling mode. See
  https://vtdn.dev/docs/decset/mode80-decsdm/ and the VT340 graphics manual:
  https://vt100.net/docs/vt3xx-gp/chapter14.html
- Local asset: `packages/wasm/core/pkg/chafa.wasm` is embedded but has no active
  renderer binding. It is an encoder-quality oracle, not the compositor.

## Implementation

- [x] Replace the per-patch native emission loop with one composited scene
  canvas. Preserve transparent gaps so ANSI text between diagrams remains
  visible; use one Sixel DCS or Kitty image per invalidated frame.
- [x] Keep raw patches only as retained scene inputs and derive one previous
  canvas footprint for clearing. Do not retain multiple terminal-native planes.
- [x] Make `ImageRenderable` reject fully off-screen frames and clip partial
  frames; never clamp a negative image coordinate to row 1.
- [x] Clear the previous unified canvas, repaint text, emit the next unified
  canvas, then restore the input cursor as one renderer transaction.
- [x] Replace Mermaid's PNG data-URL/Jimp decode handoff with direct Resvg RGBA
  frame delivery to `ImageRenderable`; add per-stage timing logs for Mermaid
  layout, rasterization, and frame preparation. Native Sixel encoding/write
  telemetry remains a renderer follow-up.
- [ ] Add native Sixel encode/write timing to the renderer diagnostics.
- [x] Add native-protocol tests proving two images produce one native canvas/DCS,
  the Sixel DCS remains inside the synchronized frame, and cursor restoration
  remains correct.
- [ ] Add an executable transparent-gap oracle and a scroll/reflow replacement
  oracle that proves text survives between images and the replacement frame
  still emits exactly one DCS.

### Codebase adoption

- [x] Remove the unused `<image-plane>` / Three.js registration and its tests.
- [x] Remove `FrameSyncWriter` lifecycle wiring; native graphics must have no
  post-`FRAME` terminal-write path.
- [x] Keep direct Sixel/Kitty writers isolated to experiments; production TUI
  code must not import them. Retain PNG only as the symbols fallback input.
- [x] Move the obsolete production Three.js dependency to dev-only support for
  isolated experiments, and remove its dedicated image-plane test suite.
- [x] Update comments and focused tests so `MediaImage` is documented as the
  single scrollable graphics component.

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

### Codebase-adoption baseline [Exact]

- `packages/opencode/src` has no `<image-plane>` consumer; registration in
  `app.tsx` and its dedicated tests were the production image-plane path.
- `FrameSyncWriter` is initialized and destroyed in `app.tsx`, but no caller
  schedules a write through it.
- Direct terminal encoders remain live in tracked experiments and must not be
  deleted in this slice. `MediaImage` uses RGBA for native graphics and PNG
  only for its symbols fallback.

### Codebase-adoption validation [Exact]

- `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts`
  (`packages/opencode`): 25 tests, 0 failures, 61 assertions.
- `bun typecheck` (`packages/opencode`): passed.
- `bun run script/build.ts --single` (`packages/opencode`): Windows x64 binary
  smoke passed: `10.0.690`. The unscoped cross-platform build was not used as
  its installed Bun canary cannot download `bun-linux-aarch64-v1.4.0`.
- Production-source search has no `FrameSyncWriter`, `TexturePlaneRenderable`,
  `<image-plane>`, or `@opentui/three` import. `@opentui/three` remains only
  as a dev dependency for isolated experiments; model-output policy text is not
  executable TUI code.

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | targeted OpenTUI Zig/TS image tests (`packages/opentui`) | two diagrams compose into one Sixel canvas; text gaps and cursor survive |
| 2 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | direct RGBA pipeline preserves sizing and Mermaid rendering |
| 3 | `bun typecheck` (`packages/opencode`) | typecheck passes |
| 4 | `pwsh -File .\\_build.ps1` (repo root) then cmd_runner direct WT screenshot | visible text and diagrams move together through scroll; no overlap |

### Current validation [Exact]

- `bun run build:native:dev` (`packages/opentui/packages/core`) passes after
  the unified-canvas transaction correction.
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
- Full product build completed with binary smoke test `10.0.688`.
- Direct Windows Terminal per-plane scene-recomposition capture (superseded by
  unified-canvas acceptance):
  `logs/cmd_runner/20260729T050306Z_bf5a5335/scene-recompose.png`. The image
  moved from row 3 to row 20 and no old Sixel plane remained.
- Direct Windows Terminal unified-Zig-frame capture:
  `logs/cmd_runner/20260729T073914Z_5a992dde/unified-zig-frame.png`. The status
  text and the one Sixel canvas are visible together after the diagram moves to
  row 20; the source test asserts `syncSet < Sixel DCS < syncReset`.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Baseline for the original per-plane implementation recorded
- [x] Unified-canvas implementation only after its baseline
- [x] Unified-canvas post-implementation smoke passed before completion
