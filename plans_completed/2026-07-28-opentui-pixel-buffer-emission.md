# OpenTUI pixel-buffer emission ordering

## Context / goal

`CliRenderer.render()` invokes `prepareRenderFrameWithWriter()` before
`renderPixels()`. The preparation step clears `nextPixelBuffer`, which erases
the patches JavaScript produced for that same frame. Restore the invariant that
pixel patches survive until Kitty/Sixel emission finishes.

## State Vector Manifest (ADID 15.4.3)

### 1. Goal and scope

Goal: preserve JavaScript-produced RGBA patches through the native frame until
one Kitty/SIXEL emission pass consumes them. Scope is native pixel-buffer
ordering only; it does not redesign scene composition or terminal layout.

### 2. Current state and artifacts

`CliRenderer.render()` now emits queued RGBA before clearing next-frame
patches. The native regression observes a SIXEL DCS, and the direct Windows
Terminal lab screenshot proves the Mermaid raster is visible. Artifacts are
`renderer.zig`, the native renderer test, and the standalone Windows Terminal
lab.

### 3. Task definition

| Task | State | Evidence |
|---|---|---|
| Preserve queued pixel patches until native emission finishes. | done | Native regression and `renderer.zig` implementation. |
| Encode queued RGBA as SIXEL. | done | `zig test sixel.zig`: 3 pass, 0 fail. |
| Prove direct Windows Terminal visibility. | done | `opentui-direct-wt-fixed.png`. |
| Restore the Windows native test harness. | done | `bun run test:native`: 1,688 pass, 22 skipped. |

### 4. Verification criteria

Named test cases and oracles: the targeted native regression must observe
`ESC P0;1;0q`; `zig test sixel.zig` must pass; `bun run build:native` must
succeed; and the direct `wt.exe` lab screenshot must show the Mermaid raster.

### 5. Epistemic claim ledger

| Claim | Mark | Evidence |
|---|---|---|
| The prior clear ordering erased same-frame pixel patches. | Exact | Native render ordering inspection and blank direct-WT baseline. |
| Queued RGBA survives to SIXEL output. | Exact | Native regression and direct-WT screenshot. |

### 6. Certified transition state

`safety_critical: false`; no physical action or certification envelope applies.

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
- [x] Baseline encoder test recorded [Exact]: `zig test sixel.zig` — 3 pass, 0 fail.
- [x] Regression assertion added: queued RGBA must yield `ESC P0;1;0q` in native memory output.
- [x] Direct Windows Terminal post-implementation oracle passed: [opentui-direct-wt-fixed.png](../experiments/tui-image-rendering/opentui-direct-wt-fixed.png) shows the Mermaid raster with `sixel:true` and `10×20px` cells.
- [x] `bun run build:native` passed (`packages/opentui/packages/core`, 2026-07-28).
- [x] Windows native-test command restored: `bun run test:native` — 1,688 pass, 22 skipped.
