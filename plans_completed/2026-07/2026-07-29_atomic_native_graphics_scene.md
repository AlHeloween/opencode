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

## State Vector Manifest (ADID 15.4.3)

### 1. Goal and scope

Goal: retain hybrid native graphics as one composited canvas synchronized with
the text frame, so scroll/reflow cannot leave stale terminal-native planes.
Scope is the hybrid graphics transport foundation; it is not the raster
viewport backend and must preserve ANSI fallback behavior.

### 2. Current state and artifacts

The per-patch loop is replaced with one composited native canvas, the previous
canvas footprint is cleared, partial images are clipped, and the cursor tail is
emitted in the same synchronized frame. Focused image-protocol tests pass;
direct Windows Terminal captures show one frame moving with status text.
Native SIXEL compose/encode/write timings are recorded on render stats and the
debug overlay. The transparent-gap + replacement-frame oracle is executable and
green.

### 3. Task definition

| Task | Weight | Dependencies | State | Next exact transition |
|---|---:|---|---|---|
| Unified native canvas and cursor transaction. | 0.40 | — | done | None. |
| Direct Resvg RGBA delivery and stage timings. | 0.20 | unified canvas | done | None. |
| Native SIXEL encode/write diagnostics. | 0.15 | unified canvas | done | None. |
| Transparent-gap and scroll/reflow oracle. | 0.25 | unified canvas | done | None. |

### 4. Verification criteria

Named oracles: focused OpenTUI native-protocol tests; OpenCode Mermaid/media
tests; `bun typecheck`; native build; and a direct Windows Terminal screenshot
proving text and diagrams move together through scroll/reflow. The remaining
two tasks are done only when their named renderer timing and transparent-gap
oracles pass.

Named test cases: two-image composition emits one native DCS; cursor restoration
occurs in the synchronized frame; Mermaid/media sizing stays stable; a
transparent text gap survives a replacement frame; and scroll/reflow removes
the old canvas before drawing one replacement canvas.

Acceptance criteria: timing diagnostics identify native SIXEL encode and write
cost; the transparent-gap/reflow fixture passes; all named native and Mermaid
tests pass; and the direct Windows Terminal screenshot shows text and graphics
moving together with no stale plane.

Evidence requirements: retain focused test output, native build output,
timing logs, direct Windows Terminal screenshots, and the exact fixture proving
one DCS with a surviving text gap.

### 5. Epistemic claim ledger

| Claim | Mark | Evidence / boundary |
|---|---|---|
| The renderer emits one native canvas/DCS for the composited scene. | Exact | Focused protocol tests and synchronized frame assertion. |
| Transparent gaps preserve ANSI text during all replacements. | Exact | Native oracle: gap text survives first and replacement frames; exactly one DCS each. |
| Scroll/reflow cannot leave stale planes. | Exact | Replacement frame clears previous footprint before the next unified DCS; direct WT captures retained. |
| SIXEL encode/write costs are visible in diagnostics. | Exact | `nativeGraphicsCompose/Encode/WriteTime` on render stats + debug overlay. |

### 6. Certified transition state

`safety_critical: false`; no physical action or certification envelope applies.

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
- [x] Add native Sixel encode/write timing to the renderer diagnostics.
- [x] Add native-protocol tests proving two images produce one native canvas/DCS,
  the Sixel DCS remains inside the synchronized frame, and cursor restoration
  remains correct.
- [x] Add an executable transparent-gap oracle and a scroll/reflow replacement
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
- [x] Defer cursor/mouse finalization until the unified graphics node is emitted,
  so the one renderer display list is text, native canvas, then cursor tail.

## Smoke Tests

### Baseline

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | existing image sizing and Mermaid tests pass | 24 pass, 0 fail, 57 expects |
| 2 | `bun test src/tests/renderer.image-protocol.test.ts` (`packages/opentui/packages/core`) | existing graphics capability test passes | 2 pass, 0 fail, 8 expects |
| 3 | direct WT test (`dist/bin/opencode.exe`) | reproduce Mermaid scroll/reflow without stale planes | superseded by unified-canvas captures below |

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
- `bun run build:native:dev` (`packages/opentui/packages/core`): passed after
  moving final cursor ownership to the renderer tail.
- `bun test src/tests/image-renderable.test.ts src/tests/renderer.image-protocol.test.ts`
  (`packages/opentui/packages/core`): 4 tests, 0 failures, 10 assertions.
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
- `bun run test:native` (`packages/opentui/packages/core`) now executes on
  Windows: 1,688 pass, 22 skipped. This supersedes the earlier Zig 0.15.2
  `convertPathArg` limitation; the direct Windows Terminal oracle remains
  required because native tests do not prove terminal presentation.
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
- [x] SIXEL encode/write diagnostics oracle passed (`bun run test:native`: 1689 pass, 22 skipped; transparent-gap + timing test)
- [x] Transparent-gap / replacement-frame oracle passed (exactly one DCS; gap text `AB` present; clear before image)

### Finalization [Exact] (2026-07-30)

- Native suite: `bun run test:native` (`packages/opentui/packages/core`) — 1689 pass, 22 skipped.
- Focused TS: `bun test src/tests/image-renderable.test.ts src/tests/renderer.image-protocol.test.ts src/tests/renderer.render-stats.test.ts` — 8 pass, 0 fail.
- Diagnostics surface: `RenderStatsSnapshot.nativeGraphicsComposeTime|EncodeTime|WriteTime` via FFI; debug overlay lines `Gfx compose/encode/write`.
