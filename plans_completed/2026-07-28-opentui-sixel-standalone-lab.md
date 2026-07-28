# Standalone OpenTUI Sixel Mermaid lab

## Context / goal

Isolate terminal graphics from the model/session transcript. The experiment must
render one Mermaid diagram through `CliRenderer` and `ImageRenderable`, then be
captured using cmd_runner's direct Windows Terminal path.

## Prior art

reuse: local — `experiments/tui-image-rendering/.../smoketest-sixel.tsx` validates
the Mermaid-to-Sixel stream but bypasses OpenTUI; `MediaImage` and
`ImageRenderable` are the production image path to exercise.

## Implementation

- [x] Add a standalone Mermaid-to-RGBA OpenTUI renderer under `experiments/tui-image-rendering/`.
- [x] Display detected graphics capability, cell geometry, and exit instruction as text.
- [x] Add a batch launcher suitable for direct Windows Terminal screenshot capture.
- [x] Validate through direct Windows Terminal and retain a screenshot artifact path.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `cmd_runner start --terminal wt --direct-terminal ... dragon.bat` (`experiments/vision`) | continuous raster Sixel screenshot | passed: raster image is smooth in `dragon-direct.png` (20260728T055332Z_fec7010a) |
| 2 | production direct TUI Mermaid run | OpenTUI diagram visible | failed: persisted final Mermaid text was not drawn (20260728T055610Z_7a013187) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|--------------|
| 1 | standalone script via direct `wt.exe` | text diagnostics and image visibility are captured separately |
| 2 | standalone script normal exit | exits after `Esc` |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation may begin.
- [x] Standalone script launched directly in Windows Terminal and closed with `Esc` (2026-07-28).
- [x] Screenshot recorded: `experiments/tui-image-rendering/opentui-direct-wt.png`.
- [x] Initial result: capabilities report `sixel:true`, cell `10×20px`, and PNG `512×142px`; the `ImageRenderable` region is blank. This proves the defect is in the OpenTUI image path, not cmd_runner or ConPTY.
- [x] Root cause and fix: `prepareRenderFrameWithWriter()` cleared `nextPixelBuffer` before `renderPixels()` emitted Sixel. The buffer now clears after emission.
- [x] Final direct Windows Terminal screenshot: `experiments/tui-image-rendering/opentui-direct-wt-fixed.png` shows the diagram with native Sixel pixels.
