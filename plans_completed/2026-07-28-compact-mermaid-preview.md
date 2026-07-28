# Compact Mermaid transcript previews

## Context / goal

Keep Mermaid diagrams readable in terminal-native graphics while preventing an inline diagram from consuming the full attachment image budget or showing excessive empty canvas.

## Prior art

reuse: local — `MediaImage.nativeImagePixelSize()` already contains raster images; Mermaid currently invokes the generic interactive 80-column × 40-row attachment preset.

## Implementation

- [x] Record focused image-sizing and Mermaid-render baselines.
- [x] Add a diagram-specific layout preset with compact native-graphics bounds.
- [x] Route transcript Mermaid previews through that preset without changing attachment sizing.
- [x] Add regression tests for the diagram pixel/cell cap and Mermaid rendering contract.

## Smoke Tests (required — PRE-FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tui/media-image-three.test.ts` (`packages/opencode`) | pass | 20 pass, 0 fail (20260728T000014Z_8fcb7d35) |
| 2 | `bun test test/util/mermaid.test.ts` (`packages/opencode`) | pass | 11 pass, 0 fail (20260728T000014Z_dcaa78f2) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/tui/media-image-size.test.ts test/util/mermaid.test.ts` (`packages/opencode`) | diagram layout and Mermaid regressions pass |
| 2 | `bun test test/util/mermaid.test.ts` (`packages/opencode`) | Mermaid PNG pipeline passes |
| 3 | `bun typecheck` (`packages/opencode`) | no TypeScript diagnostics |
| 4 | `pwsh -File .\\_build.ps1 -SkipOpenTui` (repository root) | packaged binary version smoke passes |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation may begin after baseline.
- [x] Post-implementation smoke passed before completion: 20 targeted tests pass, typecheck has 0 diagnostics, packaged smoke 10.0.646.
