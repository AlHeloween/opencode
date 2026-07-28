# Calibrated Sixel cell renderer

## Context / goal

Render Sixel images at the terminal's direct character-cell pixel size instead of deriving it from a DPI-scaled window size. This makes Mermaid raster dimensions agree with the target Sixel grid, as Kitty's explicit `c`/`r` placement already does.

## Prior art

reuse: local + protocol — Chafa's 32×12 cell request emitted a 130×240 Sixel raster, consistent with an 8×20 terminal cell. Kitty sends explicit `c`/`r` target cells. XTerm documents `CSI 16t` as the direct cell-pixel-size query; OpenTUI currently queries only `CSI 14t` window pixels.

## Implementation

- [x] Query and parse direct terminal cell pixels with `CSI 16t`.
- [x] Use that measurement for Sixel image sizing and native-image admission.
- [x] Cover parser, renderer input, and Sixel sizing behavior; rebuild the Windows binary.

## Smoke Tests (required — PRE-FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test src/lib/terminal-capability-detection.test.ts src/tests/renderer.input.test.ts` (`packages/opentui/packages/core`) | pass | 120 pass, 0 fail (20260728T024634Z_b92e6ab0) |
| 2 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | pass | 22 pass, 0 fail (20260728T024634Z_508733e2) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | same core test command | parser and renderer-input regressions pass |
| 2 | same opencode test command | calibrated Sixel sizing and Mermaid contracts pass |
| 3 | `bun run build:native` (`packages/opentui/packages/core`) | staged Windows OpenTUI DLL builds |
| 4 | `bun run build --single --skip-install` (`packages/opencode`) | Windows artifact version smoke passes |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation begins after baseline.
- [x] Post-implementation smoke passed before completion: 123 core tests pass (20260728T024955Z_c8530a7d); 23 Mermaid/image tests pass (20260728T024955Z_ae089694); native DLL staged (20260728T025211Z_e654623d); Windows artifact smoke reports `10.0.654` (20260728T025224Z_b9cbb680).

## Visual validation

Windows Terminal must still confirm the final raster because `cmd_runner`'s ConPTY viewport does not provide a trustworthy Sixel visual oracle. The fresh artifact uses `CSI 16t` direct cell metrics rather than `CSI 14t` window-pixel division.
