# Mermaid natural layout bounds

## Context / goal

Mermaid diagrams are currently forced into a `32 × 12` cell compact-preview
box while regular inline images use the terminal-aware `80 × 40` contain box.
This makes a complex diagram occupy the same small footprint as a trivial one,
destroying label readability. Keep contain fitting as the safety limit, but
apply the same natural terminal bounds to diagrams and attachments.

## Prior art

- `packages/opencode/src/cli/cmd/tui/component/media-image.tsx` contains the
  terminal-aware bounds helper and the native pixel/layout conversion.
- `packages/opencode/test/tui/media-image-size.test.ts` already exercises the
  compact-preview policy that reproduces the defect.

## Implementation

- [x] Remove the Mermaid-only `32 × 12` preview cap from
  `mediaImageCellBounds`; retain terminal-width and terminal-height safety
  bounds.
- [x] Replace the policy regression test with one proving that diagrams and
  attachments receive the same terminal-aware contain budget.
- [x] Run targeted TUI sizing tests and typecheck; record results and complete
  this plan only after both pass.

## Smoke Tests

### Baseline

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tui/media-image-size.test.ts` (`packages/opencode`) | existing compact-preview policy passes | 13 pass, 0 fail, 31 expects; the passing `diagram previews use a compact transcript budget` assertion confirms the defect |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/tui/media-image-size.test.ts` (`packages/opencode`) | diagram and attachment bounds are equal and terminal-aware; all tests pass |
| 2 | `bun typecheck` (`packages/opencode`) | TypeScript typecheck passes |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before completion

## Results

| # | Command (cwd) | Actual [Exact] |
|---|---------------|----------------|
| 1 | `bun test test/tui/media-image-size.test.ts` (`packages/opencode`) | 13 pass, 0 fail, 31 expects; Mermaid and attachment bounds both resolve to `80 × 40` in a `120 × 50` terminal |
| 2 | `bun typecheck` (`packages/opencode`) | passed; cmd_runner exit code `0` |
| 3 | `pwsh -File .\\_build.ps1 -SkipOpenTui` (repo root) | passed; packaged `dist/opencode-windows-x64/bin/opencode --version` smoke test reports `10.0.683` |
