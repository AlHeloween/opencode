# Runtime Sixel capability probe

## Context / goal

OpenTUI currently chooses Sixel from terminal-environment heuristics or DA1.
The packaged Windows process can have neither `WT_SESSION` nor `TERM`, while
the real terminal still renders Sixel. Detect standards-supported positive
replies where available, and make an explicit configured Sixel choice an
authoritative native OpenTUI capability override.

## Prior art

reuse: local `packages/opentui/packages/core/src/zig/ansi.zig` already defines
the XTSMGRAPHICS Sixel geometry query; xterm control-sequence documentation
defines `CSI ? 2 ; 1 ; 0 S` and successful `CSI ? 2 ; 0 ; … S` replies.

## Implementation

- [x] Send the existing XTSMGRAPHICS Sixel query during startup capability negotiation.
- [x] Recognize only a successful Sixel geometry reply and set `caps.sixel` in the native terminal state.
- [x] Consume that reply in the TypeScript capability dispatcher so it cannot become user input.
- [x] Make `image_protocol: "sixel"` set native OpenTUI Sixel capability explicitly; `symbols` must disable native graphics.
- [x] Add native and TypeScript regression coverage for successful/failed probes and explicit overrides.
- [x] Resolve the TUI `auto` policy with the independent graphics detector and persist its selected native protocol; log rejected remote overrides and the iTerm2 symbols fallback.
- [ ] Reserve native image layout rows so assistant metadata cannot overlap Sixel diagrams.
- [ ] Rebuild and verify the packaged TUI records the probe result or override and selects native Sixel.

## Smoke Tests

### Baseline

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | packaged TUI Mermaid run | native Sixel | fallback; `sixel:false`, `detectedMode:none`, 2026-07-28 unified log `1785242635707` |
| 2 | direct Windows Terminal OpenTUI lab | native Sixel | passed; `sixel:true`, 10x20px cells, `experiments/tui-image-rendering/opentui-direct-wt-fixed.png` |
| 3 | raw capability probe through ConPTY | usable Sixel response | no XTSMGRAPHICS reply; DA1/DA2/DA3 only, `20260728T134052Z_0adc8323` |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | focused OpenTUI terminal tests (`packages/opentui/packages/core`) | successful XTSMGRAPHICS reply enables Sixel; failures do not; explicit override remains authoritative after later capability replies |
| 2 | `bun typecheck` (`packages/opencode`) | zero diagnostics |
| 3 | `pwsh -File .\\_build.ps1` (repository root through cmd_runner) | packaged Windows binary builds successfully |
| 4 | packaged TUI Mermaid run with `image_protocol: "sixel"` | unified log records native `selectedMode:sixel`; screenshot has continuous raster |

### Results so far

| # | Command (cwd) | Actual [Exact] |
|---|---------------|----------------|
| 1 | focused OpenTUI terminal tests (`packages/opentui/packages/core`) | 451 pass, 0 fail, 1572 expectations; includes XTSMGRAPHICS and explicit Sixel/symbols override coverage |
| 2 | `bun typecheck` (`packages/opencode`) | passed with zero diagnostics |
| 3 | `pwsh -File .\\_build.ps1` (repository root through cmd_runner) | OpenTUI core, solid, three, and spinner all built; packaging remains blocked because `TOTALCMD64.EXE` PID 20564 has `dist\\bin` as its working directory, so `_build.ps1:386` cannot remove the directory |
| 4 | focused OpenTUI image protocol tests | 452 pass, 0 fail; includes accepted local override and rejected remote override |
| 5 | `bun typecheck` (`packages/opencode`) | passed with zero diagnostics after auto-policy wiring |
| 6 | `pwsh -File .\\_build.ps1 -SkipOpenTui` (repository root through cmd_runner) | complete; packaged 10.0.677 smoke test and release artifact staging passed |
