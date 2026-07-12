# 3D GUI Themes — Test Plan

**Status:** [x] Complete — implemented 2026-07-07
**Effort:** 1h
**Parent:** Smart Terminal Image Rendering (fb49153e6)

**Abstract:** Comprehensive test suite for the TexturePlaneRenderable + extend() pipeline, foundation for future 3D GUI themes (textured backgrounds, icons, animated sprites).

---

## Test Matrix

### A — TexturePlaneRenderable Unit Tests

| # | Test | What it verifies |
|---|------|-----------------|
| A1 | Constructor stores url/mime | Options propagation |
| C2 | Data URL → temp file → cleanup | File lifecycle |
| C3 | Invalid URL returns error | Graceful degradation |
| C4 | loadTextureFromFile integration | TextureUtils bridge |
| C5 | Three.js scene construction | PlaneGeometry + Mesh + Scene |
| C6 | Child renderable lifecycle | add() + destroySelf() |
| C7 | Async load state (loading→loaded) | State transitions |
| C8 | Error state (loadError) | Error display path |

### B — extend() Registration Tests

| # | Test | What it verifies |
|---|------|-----------------|
| B1 | extend() adds to component catalogue | Registry population |
| B2 | <image-plane> renders without crash | JSX integration |
| B3 | Width/height layout | Renderable layout system |
| B4 | Multiple instances | Re-entrancy |

### C — MediaImage Fallback Chain Tests

| # | Test | What it verifies |
|---|------|-----------------|
| C1 | detectBestProtocol returns kitty | WezTerm env detection |
| D2 | Graphics terminal → use3D=true | Decision logic |
| C3 | Non-graphics terminal → use3D=false | Fallback logic |
| C4 | image_protocol override in tui.json | Config override chain |
| C5 | chafa-wasm symbols fallback | Rendering output validation |
| C6 | All errors logged (no silent catch) | Logging compliance |

---

## Sub-plans

### 1. `test/tui/texture-plane-renderable.test.ts` — 8 unit tests
**Scope:** 1 new test file, ~150 lines
**Covers:** A1-A8
**Oracle:** `bun test` — all pass

### 2. `test/tui/media-image-fallback.test.ts` — 6 integration tests  
**Scope:** 1 new test file, ~120 lines
**Covers:** C1-C6
**Oracle:** `bun test` — all pass

### 3. `test/tui/extend-registration.test.ts` — 4 tests
**Scope:** 1 new test file, ~80 lines
**Covers:** B1-B4
**Oracle:** `bun test` — all pass

---

## Verification

| Oracle | Target |
|--------|--------|
| `bun test test/tui/texture-plane-renderable.test.ts` | 8/8 pass |
| `bun test test/tui/media-image-fallback.test.ts` | 6/6 pass |
| `bun test test/tui/extend-registration.test.ts` | 4/4 pass |
| `bun test test/tui/media-image-three.test.ts` | 20/20 pass (no regression) |
| `bun test test/util/terminal-graphics.test.ts` | 18/18 pass (no regression) |
| `bun typecheck` | 0 errors |

**Total: 56 tests across 5 files**

## Implementation Notes

- All `catch` blocks logged via `log.warn("bug: ...")` or `log.debug(...)`
- No silent fallbacks — every branch produces a log entry
- Temp files cleaned up in `finally` blocks
- Three.js imports lazy-loaded (heavy deps, only loaded for 3D path)
