# Sixel palette fidelity for Mermaid previews

## Context / goal

Make Windows Terminal Mermaid diagrams legible rather than smeared when their anti-aliased PNG raster exceeds Sixel's 256-color palette.

## Prior art

reuse: local — `chafa 1.18.2 --format=sixels` emits `DCS P0;1;0q` followed by a `"1;1;width;height` raster declaration and preserves a high-quality adaptive palette. OpenTUI currently emits `DCS Pq` without a raster declaration and maps every palette-overflow color to index 0.

## Implementation

- [x] Emit a Chafa-compatible Sixel raster declaration.
- [x] Map overflow colors to their nearest emitted palette color instead of palette index 0.
- [x] Add native encoder regressions and rebuild the local OpenTUI DLL.

## Smoke Tests (required — PRE-FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `zig build` (`packages/opentui/packages/core/src/zig`) | native DLL compiles | pass (20260728T015230Z_773d2a6f) |
| 2 | `bun run test:native` (`packages/opentui/packages/core`) | native test suite runs | fails: Zig has no `test` build step (20260728T015216Z_ea23214b) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `zig build` (`packages/opentui/packages/core/src/zig`) | native Sixel encoder and DLL compile |
| 2 | `zig test sixel.zig` (`packages/opentui/packages/core/src/zig`) | all native Sixel encoder tests pass |
| 3 | `bun run build:native` (`packages/opentui/packages/core`) | rebuilt local Windows OpenTUI DLL is staged |
| 4 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | transcript image contracts pass |
| 5 | `bun run build --single --skip-install` (`packages/opencode`) | Windows artifact version smoke passes |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation begins after baseline.
- [x] Post-implementation smoke passed before completion: `zig build` pass (20260728T015424Z_7ddb7f1e); 3 Zig Sixel tests pass (20260728T015743Z_b3c9f353); native DLL staged (20260728T015444Z_a79b3854); 22 transcript-image tests pass (20260728T015545Z_6654a3a3); Windows artifact smoke reports `10.0.651` (20260728T015609Z_7313ad1f).

## Validation note

`bun run test:native` remains an invalid project script because Zig exposes no `test` step. Direct `zig test sixel.zig` executes the affected native test file.
