<!-- intention: the fork has no native image decode (webp broken, jimp+sharp bridge in the app layer) and re-encodes sixel payloads every render -> take upstream's two named parts (native decoder, sixel payload cache) into our zig core, one dll rebuild -->
# Native image decode + sixel payload cache — two named parts from opentui-0.5.11

status: 2026-09-21 — SUPERSEDED by the re-base (`plans/2026-09-20_rebase-on-opentui-0.5.11.md`). Their tree
IS the base now, so the decoder arrives with it and vendoring libwebp into OUR zig core is moot. T0 ✅ and
T1 ✅ (the sixel payload cache) landed, then were PARKED together with the whole raster stack by the re-base —
their per-placement sixel cache covers the same ground. T2–T5 are NOT executed; do not resume them without a
measured need.
scope: packages/opentui/packages/core/src/zig/**, packages/opentui/packages/core/scripts/build.ts,
       packages/opencode/src/util/image-decode.ts, packages/opencode/src/cli/cmd/tui/component/media-image.tsx
owner: «Ага, давай» (2026-09-20) — the package: decoder port + sixel cache, one dll rebuild.

## Context — measured (do not re-derive)

- `external/opentui-0.5.11/packages/native` carries a **native image decoder**: `image.zig` (1307 lines) +
  C shims `ot_image_{png,jpeg,gif,webp}_probe/decode` + vendored **libwebp**; TS API `NativeImage`
  (`core/src/image.ts`). Proven by their tests (lossy/lossless/alpha webp fixtures).
- Our fork has **no native decode**. Attachments are WebP since 2026-09-18 (`a42599aa60`) and jimp cannot
  read WebP → `[image unavailable]`; the app layer was fixed by the sharp bridge (`util/image-decode.ts`,
  `d9439e2a8b`) — this port replaces that bridge with the native path.
- Their **sixel payload cache**: key `{image_handle, source crop, cell/pixel size, opacity, background_hash}`;
  entry `{payload, last_used}`; LRU; caps 32 MiB / 256 entries; hits/misses counters; **position and
  DCS/tmux framing stay OUT of the key**; transparent placements cached empty. Tests:
  `native/src/tests/renderer_test.zig:150-191, 4360-4403`.
- Ours: `Image.renderPixels` stamps pixels **every render pass** → `emitPixelScene` (renderer.zig:1700)
  → `sixel.IMAGE.create` **encodes every time**; only `palette_index_cache` + a ~60 Hz raster FPS floor +
  `nativeGraphicsEncodeTime` (the «Gfx encode» overlay) exist. Our emit is ONE composed canvas per frame
  (`COMPOSITED_NATIVE_IMAGE_ID`), not per-placement ⇒ the cache IDEA transfers, not the code.
- Toolchain on this host: `zig version` → **0.15.2** (our build.zig supports exactly that). Build:
  `bun scripts/build.ts --native` (patches uucode for Windows, runs `zig build -Doptimize=ReleaseFast` in
  `src/zig`, then copies the libs into `node_modules/@opentui/core-win32-x64` AND the sibling
  `packages/core-win32-x64/`).

## Tasks

- [x] **T0 — toolchain sanity.** DONE 2026-09-20: `bun packages/opentui/packages/core/scripts/build.ts --native`
      → exit 0, «Built: @opentui/core-win32-x64»; the lib builds and is copied to the sibling package. The
      dll was backed up first (`opentui.dll.pre-native-port.bak`). No porting before this: fail-early held.
- [x] **T1 — sixel payload cache (ours; no vendoring).** DONE 2026-09-20: `sixel.zig` split into
      `encodePayload` (position-independent bytes) + `writePayload`; `renderer.zig` gained
      `sixelPayloadCache` (key = content hash + size — position OUT, exactly upstream's invariant),
      LRU by `last_used`, caps 32 MiB / 256 entries, `sixelCacheHits/Misses` counters, cache freed in
      deinit. Oracle: new zig test (renderer_test.zig) — unchanged frame → NO emission (`pixelSceneChanged`
      already dedups); new composition → miss; RETURNING composition → hit (scroll-back case);
      `zig build test` exit 0; `--native` rebuild exit 0.
      Finding recorded: the whole-canvas cache cannot fix the remaining cost (any patch change re-encodes
      ALL images as one canvas); a per-placement payload model would — that is a design decision, not a sneak.
- [ ] **T2 — native decoder vendor (REVISED 2026-09-20, owner question «они перешли на 0.16.0?»).**
      Upstream is on Zig **0.16.0** (`external/opentui-0.5.11/packages/native/build.zig:10-12`), our core on
      **0.15.2** — so `image.zig` (1307 lines, 0.16 APIs) is NOT ported and the toolchain is NOT bumped.
      Vendored 2026-09-20: `src/zig/vendor/libwebp` (**85 files**, pinned 1.6.0, staged by
      `experiments/2026-09-20_native-decode/vendor-libwebp.mjs`). Still to do: a minimal C shim
      (`ot_webp_probe`/`ot_webp_decode` — their `image-shim.c:753-798` touches ONLY libwebp's public API;
      lcms2/stb/wuffs stay behind) + a thin 0.15.2 Zig binding in our lib. PNG/JPEG/GIF keep the working
      jimp/sharp path. Oracle: `zig build` produces the lib with the new symbols; decode of a real webp
      fixture passes.
- [ ] **T3 — bindings.** Expose the webp decode through `zig.ts` (function table + struct); TS wrapper
      `nativeWebpDecode(bytes) -> {width, height, rgba}`. Oracle: a bun test against the built dll.
- [ ] **T4 — app switch.** `util/image-decode.ts` prefers the native decode; jimp/sharp remain the fallback.
      Oracle: `test/util/image-decode.test.ts` stays green; media-image renders the webp screenshot.
- [ ] **T5 — rebuild + deploy note.** One dll rebuild; deploy to `bin/` is the owner's action.

## Smoke Tests

- T0: build exit code read from the runner's state.json; artifact exists.
- T1: zig renderer/sixel test suite + the new hit/miss test.
- T2/T3: decode oracle on a real webp fixture (upstream ships `packages/core/src/tests/fixtures/images/alpha.webp`).
- T4: `bun test test/util/image-decode.test.ts test/tui/media-image-fallback.test.ts test/tui/media-image-size.test.ts`.

## Risks / guards

- Version skew (their 0.16 vs our 0.15.2) — RESOLVED by design: only the C layer + libwebp are taken
  (`image.zig` and the toolchain are not touched).
- First-ever fork-lib rebuild on this host: T0 proves it before anything is ported.
- Keep every checkpoint green: T1 lands alone (ours, no vendoring); T2+ lands as one patch with the dll build.
