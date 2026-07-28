# OpenTUI pixel-buffer emission ordering

## Context / goal

`CliRenderer.render()` invokes `prepareRenderFrameWithWriter()` before
`renderPixels()`. The preparation step clears `nextPixelBuffer`, which erases
the patches JavaScript produced for that same frame. Restore the invariant that
pixel patches survive until Kitty/Sixel emission finishes.

## Prior art

reuse: local — `renderer.zig` already has a single `renderPixels()` emission
path and `TestRenderer` captures native memory output for protocol assertions.

## Implementation

- [x] Add a native regression that queues RGBA and requires a Sixel DCS in output.
- [x] Clear next-frame pixel patches only after the native emission pass.
- [x] Rebuild the native library and re-run the standalone Windows Terminal lab.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | direct `wt.exe` standalone lab | Mermaid image visible | failed: `sixel:true`, cell `10×20px`, image blank (`opentui-direct-wt.png`) |
| 2 | `zig test sixel.zig` (`packages/opentui/packages/core/src/zig`) | encoder passes | 3 pass, 0 fail (2026-07-28) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|--------------|
| 1 | targeted Zig renderer test | queued RGBA produces Sixel DCS |
| 2 | `zig test sixel.zig` (`packages/opentui/packages/core/src/zig`) | all encoder tests pass |
| 3 | `bun run build:native` (`packages/opentui/packages/core`) | native build succeeds |
| 4 | direct `wt.exe` standalone lab | Mermaid image visible in screenshot |

### Gate

- [x] Smoke requirements written.
- [x] Direct visual baseline recorded [Exact].
- [ ] Baseline encoder test recorded [Exact].
- [x] Regression assertion added: queued RGBA must yield `ESC P0;1;0q` in native memory output.
- [x] Direct Windows Terminal post-implementation oracle passed: [opentui-direct-wt-fixed.png](../experiments/tui-image-rendering/opentui-direct-wt-fixed.png) shows the Mermaid raster with `sixel:true` and `10×20px` cells.
- [x] `bun run build:native` passed (`packages/opentui/packages/core`, 2026-07-28).
- [ ] The native test runner remains deliberately disabled in `src/zig/build.zig` on Windows because Zig 0.15.2 crashes in `convertPathArg`; test execution needs separate build-harness recovery.
