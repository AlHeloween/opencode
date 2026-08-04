# Calibrated Sixel Mermaid previews

## Context / goal

Prevent inline Mermaid diagrams from overlapping later transcript content when a terminal advertises Sixel but does not provide measured pixel geometry. Keep the sharp native Windows Terminal path when that geometry is available.

## Prior art

reuse: local — OpenTUI `ImageRenderable` already converts image pixels to layout cells from `renderer.resolution`; the existing Mermaid preview preset bounds the source image but previously accepted fallback cell dimensions for Sixel.

## Implementation

- [x] Gate Sixel image emission on valid pixel-resolution, column, and row measurements.
- [x] Use a 32-column × 12-row source budget for Mermaid previews and apply it to the symbol fallback too.
- [x] Add focused regressions for calibrated and uncalibrated native image modes.

## Smoke Tests (required — PRE-FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | pass | 20 pass, 0 fail (20260728T003340Z_fc1d2aa6) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | geometry gate, compact bounds, and Mermaid pipeline pass |
| 2 | `bun typecheck` (`packages/opencode`) | no TypeScript diagnostics |
| 3 | `bun run build --single --skip-install` (`packages/opencode`) | current-platform Windows binary version smoke passes |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation begins after baseline.
- [x] Post-implementation smoke passed before completion: 22 focused tests pass (20260728T003456Z_88429023); `bun typecheck` has 0 diagnostics (20260728T003526Z_8da4b020); Windows package build smoke reports `10.0.649` (20260728T003807Z_ca8dcf9f).

## Validation note

The root `_build.ps1 -SkipOpenTui` wrapper could not clean `dist/` because the running `dist/bin/opencode.exe` holds `.codegraph/codegraph.db` (20260728T003547Z_23d3658f). The ordinary all-platform package build reached packaging but this installed Bun lacks the downloadable Linux ARM64 target (20260728T003635Z_8b3806a6). Neither condition affects the current-platform package build above.
