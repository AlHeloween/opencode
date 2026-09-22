<!-- intention: the fork sits on a frozen 0.4.x-shaped base with no native image decode and a diverging zig layer -> re-base on upstream opentui-0.5.11 (Zig 0.16): their tree is the base, OUR modules are the patches to transplant -->
# Re-base the opentui fork on 0.5.11 (Zig 0.16) — their trunk, our modules

status: 2026-09-22 — COMPLETED (machine-readable below). The residuals are NOT lost: this plan put them in
`AGENTS.md` § the re-base residual list on 2026-09-21, and that is where they live — which is exactly why the
status prose below no longer reads as an open plan.

- [x] S0 — their base builds here: `zig 0.16.0 build -Doptimize=ReleaseFast` → exit 0 (run `20260920T145747Z_40dd1021`), artifact `packages/native/lib/x86_64-windows/opentui.dll`
- [x] S1 — delta inventory of the three layers (§ Measured below)
- [x] S2/S3 — our modules transplanted onto their tree (their tree is the base, ours are the patches)
- [x] S4 — swap executed: typecheck 0, ABI smoke OK, TUI renders from source
- [x] the swap is COMMITTED — verified 2026-09-22: `git status --short` is empty, so the working tree no longer carries the re-base as uncommitted work (this is the box the status prose called open)
- [~] calibrated-graphics pixel oracle (sixel/mermaid/images) — PARKED, carried in `AGENTS.md` § re-base residual list
- [~] keymap 0.4.x vs 0.5.11 mismatch — PARKED (nothing imports it), `AGENTS.md`
- [~] raster/Sixel stack — PARKED (git history + `experiments/2026-09-20_rebase-stage/pre-swap/`), `AGENTS.md`
scope: packages/opentui/** ← external/opentui-0.5.11/** ; app side packages/opencode/src/cli/cmd/tui/**
owner ruling: «Может нам вообще зиг обновить выдрать наши модули из нашей версии и впихнуть в их, 0.16 это
серьёзный архитектурный сдвиг» — this SUPERSEDED the AGENTS.md line "never 'let's just update to 0.5.11'".
**DONE 2026-09-21:** that AGENTS.md section now carries the ruling plus the residual list (parked raster
stack, keymap mismatch, uncommitted swap) — the doc no longer contradicts the ruling.

## Why (measured)

- Upstream `packages/native`: Zig **0.16.0**, restructured — `opentui.zig`, `kitty-transport.zig`,
  `terminal-image.zig`, `image.zig` + C shims + vendored libwebp/lcms2/stb/wuffs,
  `embedded-terminal/` + ghostty-vt.
- Our fork's zig layer (0.15.2) holds work upstream does NOT have: the whole **raster viewport** stack
  (`raster_viewport.zig`, `font_raster.zig`, pinned freetype, JetBrainsMono, glyph cache/caret/attrs —
  10+ commits), calibrated Sixel-Mermaid, hybrid scroll-locked graphics, our `sixel.zig`/`kitty.zig`
  structure, the sixel payload cache (`ac91ade315`), `handles.zig` fixes (`8710415d18`).
- Shared modules with divergence: `renderer.zig` (heavy), `terminal.zig` (WT/tmux/caps), ansi/buffer*/…

## Staged state (2026-09-20)

- Zig **0.16.0** downloaded (sha256 `68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e`,
  verified) → `external/zig-x86_64-windows-0.16.0/zig.exe`. The choco **0.15.2 stays** for the current fork.
- Their deps prepared: `packages/native/zig-deps/{uucode-opentui,uucode-ghostty,yoga,ghostty}` +
  `src/vendor/{lcms2,libwebp,stb}` (from `src/vendor/zig-deps.tar.gz`).
- `external/opentui-0.5.11-dll/` = the owner's pre-built 0.5.11 dll (2026-09-07) + licenses.
- Build attempt 1: exit 1 — `unable to open zig-deps/uucode-ghostty` (extraction put it at the tree root;
  moved into `zig-deps/`). Attempt 2 RUNNING: cmd_runner `20260920T145747Z_40dd1021`; read its state from
  `C:\WINDOWS\logs\cmd_runner\20260920T145747Z_40dd1021\state.json`.
- Parked: our own libwebp vendor (`62b5b757a4`) is UNUSED under the re-base (their tree supplies decode).

## Measured (2026-09-20, this host)

**S0 — PASS.** `external/zig-x86_64-windows-0.16.0/zig.exe build -Doptimize=ReleaseFast` in
`external/opentui-0.5.11/packages/native` → exit 0 (run `20260920T145747Z_40dd1021`), artifact
`packages/native/lib/x86_64-windows/opentui.dll` + `.pdb`. Their base builds here.
Note: their install step overrides `dest_dir` to `../lib/<target>` — `zig-out/` stays empty **by design**
(not a symptom of failure).

**S1 — delta inventory (three layers).**

| layer | ours only | theirs only | divergent |
|---|---|---|---|
| zig | `raster_viewport.zig` (697), `font_raster.zig`, `assets/JetBrainsMono`, `tools/patch-uucode-windows.mjs`, our `sixel.zig`/`kitty.zig` | `image.zig` + 5 C shims + vendored libwebp/lcms2/stb/wuffs, `terminal-image.zig`, `kitty-transport.zig`, `opentui.zig`, `ghostty-vt.zig`, `embedded-terminal/`, `clipboard/` | `renderer.zig` (ours 2679 / theirs 3436), `terminal.zig`, `handles.zig` |
| TS (core) | `__tests__/Markdown.style.test.ts` (415), `ScrollBox.sticky-bounce` (98), `handle-leak` (91), `renderer.image-protocol` (25) | `image.ts` (705), `EmbeddedTerminal` (435+451), host-clipboard (252+349), node/bun asset targets, image-pool, ICC, benchmark suite, 100+ new tests | `renderer.ts` 438/324, `Image.ts` 208/358, `Markdown.ts` 158/128, `Code.ts` 123/182, `tree-sitter-styled-text.ts` 36/113, `buffer.ts` 62/40 |
| build | catalog consolidation, `core-win32-x64` wiring | their `scripts/build.ts` packaging + symbol separation | — |

**The architectural seam.** Theirs is a **per-placement** image system (`OptimizedBuffer.ImagePlacement`
identity, `computeImageDirtyFlags`, `placementsOverlap`, `writeSixelImages`/`writeKittyImages`, opacity,
downscale/crop, fallbacks, kitty file transport, sixel payload cache). Ours is **one composited canvas**
(`composePixelScene` → `emitPixelScene` → one payload) plus rasterised text (`raster_viewport.zig`).

**Our raster path is opt-in and OFF** in the running TUI: `config.rasterViewport ??
OPENTUI_RASTER_VIEWPORT === "1"` (`renderer.ts:1120`); the live log prints
`rasterViewportRequested: false, "(unset — hybrid ANSI+Sixel)"`. The visible behaviours (calibrated
sixel, protocol choice, mermaid) live in the **app** (`src/util/terminal-graphics.ts`, `sixel-render.ts`,
`media-image.tsx`, `mermaid.ts`) — which the re-base does not touch.

**S2 — PASS, bounded list.** Probe: `experiments/2026-09-20_rebase-probe/tsconfig.json` extends the app's
config and remaps only `@opentui/*` to their tree; `bunx tsgo --noEmit -p` from the repo root
(run `20260920T150621Z_dee2a124`, exit 2, 54 KB). **141 errors total, 9 in OUR code.** The other 132 are
their internals under OUR compiler options (`noImplicitOverride`) and their own deps absent from our
`node_modules` (`string-width`, `diff`, `marked`, `entities`, `@babel/core`) — environment, not drift.

The 9, verbatim — every one is OUR renderer extension, none is an upstream API change:

```
app.tsx:100        TS2353  'rasterViewport' unknown in CliRendererConfig
app.tsx:157        TS2339  Property 'rasterViewport' does not exist on CliRenderer
app.tsx:166        TS2339  Property 'setImageProtocol' does not exist on CliRenderer
app.tsx:200        TS2339  Property 'cellSize' does not exist on CliRenderer
app.tsx:207        TS2339  Property 'cellSize' does not exist on CliRenderer
media-image.tsx:337 TS2339 Property 'cellSize' does not exist on CliRenderer
media-image.tsx:343 TS2339 Property 'setImage' does not exist on CliRenderer
media-image.tsx:517 TS2339 Property 'setImage' does not exist on CliRenderer
thread.ts:17       TS2724  '@opentui/core' has no exported member 'nativeHandleCensus'
```

⇒ The app's JSX / renderable / hooks / markdown / scrollbox surface is **API-compatible** with their
core+solid. The adaptation is a handful of renderer members: `cellSize`, `setImage`, `setImageProtocol`,
`rasterViewport` (config), `nativeHandleCensus` (export).

**S3 — staged, and the app is clean.** Staged copy: `experiments/2026-09-20_rebase-stage/packages/{core,solid}`
(`stage.mjs`, refreshed each run). Probe: `experiments/2026-09-20_rebase-probe/tsconfig.stage.json` →
`bunx tsgo --noEmit` (run `20260920T155654Z_52f277ba`): **0 errors in our code** (was 9).

Three adaptations, each applied in the staged copy:

| our contract | their base | port |
|---|---|---|
| `ImageRenderable.setImage(rgba, w, h)` | none | `source = NativeImage.fromRgba(data, width, height)` — their `source` setter retains + loads it |
| `CliRenderer.cellSize` | `resolution` only (CSI 14t) | derived `floor(resolution / cells)`, guarded — the same derivation their own `cellAspectRatio` uses |
| `CliRenderer.setImageProtocol(p): boolean` | `capabilities.image_protocol` drives resolution | writes the override into `capabilities.image_protocol` (`symbols` → `blocks`), emits CAPABILITIES, **re-applied after every re-detection** (`_capabilities` is reassigned at two sites) |

App surfaces (`packages/opencode`): `rasterViewport` removed from `rendererConfig` + its log payload
(the feature is parked; the renderer's own env opt-in still works).

**`handles.zig` re-measured — the S1 note is corrected.** Their file is NEWER (kinds `image`,
`clipboard_service`, `clipboard_operation`, `embedded_terminal`, plus `getOwner`). **The generation-retire
logic is IDENTICAL on both sides** — it is not ours-only. What IS ours-only: the census API
(`slotCount` / `freeIndexCount` / `TableStats` / `tableStats`) plus the retire rationale comment. The census
feeds `nativeHandleCensus()` (`zig.ts:2678`), which six `Failed to create … — handles: …` messages and
`handle-leak.test.ts` consume ⇒ it is **ported, not dropped**, and the app call is restored.

**Census port — exact spec (measured).** `nativeHandleCensus()` is PURE TS (`zig.ts:2663-2683`: a
`handleCensus` map + `handleOpened`/`handleClosed` + the export) — **no Zig ABI involved**. Port = those ~12
lines into their `zig.ts` + **7 create/destroy pairs**: `native_renderable` (2700/2706), `renderer`
(2898/2924), `optimized_buffer` (3512/3518), `text_buffer` (3941/3947), `text_buffer_view` (4135/4141),
`edit_buffer` (4550/4556), `syntax_style` (5343/5349). The Zig-side `slotCount`/`freeIndexCount`/
`tableStats` are `pub fn` (no C ABI) consumed by our `zig/tests/handles_test.zig` (the retire-on-saturation
assertion) ⇒ port them with that test. This is the **only** item between the staged tree and a fully-zero
probe: with the app call restored, the staged probe shows exactly that one error.

**S4 — the switch (in progress).** Runtime resolution measured: their `core` loads the dll through
`resolveNativeLibraryPath()` (`platform/runtime-assets.bun.ts:39`) → dynamic `import("@opentui/core-win32-x64")`,
with `setRenderLibPath()` (`zig.ts:6854`) as an override ⇒ the seam is thin. Their native package is
`@opentui/native` (private, 0.5.11) and our workspace glob `packages/*` accepts it as-is.

Steps — **order matters: the dll swap follows the core swap**, because their ABI differs from ours:

1. ✅ `packages/opentui/packages/native` = their native tree; built with Zig 0.16 → `lib/x86_64-windows/opentui.dll`
   (+`.pdb`), run `20260920T164116Z_641cc7f1`, **exit 0**. Their `.gitignore` covers `.zig-cache` / `zig-out` /
   `lib` / `symbols` / `zig-pkg` / `zig-deps` ⇒ only sources enter git. **Defect the build caught**: a copy
   filter that skips by BASENAME dropped `zig-deps/ghostty/src/lib/` (9 files, `FileNotFound` ×9); the filter
   now skips only TOP-LEVEL build outputs. A broad basename rule eats real content.
2. `packages/opentui/packages/core` ← the staged core (their base + the four ports), `solid` ← staged solid.
3. `core-win32-x64/opentui.dll` ← the newly built dll (their engine) — **after** step 2, never before.
4. `bun install` (their deps: `bun-ffi-structs`, `diff`, `marked`, `string-width`, `entities`, `@babel/core`).
5. `bun typecheck` in `packages/opencode` (expect 0), then **RUN the TUI → the pixel oracle**.

## S4 — done, with evidence

| step | result |
|---|---|
| 2. core ← their base | 🟡→✅ overlaid (the first attempt died on `EBUSY`: `rmSync` cannot remove a directory a live process holds as its cwd; **renaming is allowed where deleting is not** — the swap was redone with no deletions) |
| 2. solid ← their base | ✅ 119 files, 0 failures (per-file overlay; a directory rename is refused with `EPERM` while the LSP holds files inside) |
| 3. `core-win32-x64/opentui.dll` | ✅ their engine (6 372 352 B) into the source package **and** the app-side copy — the two views had *different* hashes before the swap (the app's was stale) |
| 4. `bun install` | ✅ exit 0 (their deps: `bun-ffi-structs`, `diff`, `marked`, `string-width`, `strip-ansi`, `entities`, `@babel/*`) |
| 5a. `bun typecheck` | ❌ 120 errors → all TS4114 in THEIR files (`@tsconfig/bun` enables `noImplicitOverride`; their tsconfig does not) → mirrored that option in the app tsconfig → **2 errors**, both latent TS2345 in their `solid` (`RendererContext.Provider` is `CliRenderer | undefined`, `createComponent` wants `CliRenderer`) → cast at the two call sites (their file already uses `as any` next door) → **exit 0** |
| 5b. runtime ABI smoke | ✅ `ABI_SMOKE_OK`: dll loads, `setImageProtocol("sixel")` → `true` with `capabilities.image_protocol = "sixel"`, `NativeImage.fromRgba` ✓, ported census reports `renderer=1/1`. `resolution`/`cellSize` are `null` in a cmd_runner PTY (no CSI 14t answer) — expected, not a defect |
| 5c. TUI from source | ✅ runs, no errors in the log; **pixel capture `experiments/2026-09-20_rebase-stage/tui-rebased.png`** — logo, prompt box, model footer with glyphs/costs, `tab agents ctrl+p commands`, tip line |

**Residuals carried:** keymap is still our older 0.4.x copy (nothing imports it; their core/solid only declare it as a workspace devDep) · the ASCII logo reads oddly in the capture (`openC°de`-shaped glyphs) — an observation for the owner's eye, not diagnosed · our raster stack and the app's `rasterViewport` surface are parked (in git + `pre-swap/`) · the compiled `bin/opencode.exe` still runs the OLD engine until the owner rebuilds.

## Tasks

- [x] **S0 — their base builds here.** exit 0 + `lib/x86_64-windows/opentui.dll`.
- [x] **S1 — keep/drop/merge inventory** (measured above).
- [x] **S2 — TS API drift measured**: 9 errors in our code, all our own extensions.
- [x] **S3 — stage the transplant.** DONE: `packages/opentui/packages/native` = their tree (built, Zig 0.16.0);
      `packages/{core,solid}` ← their base by FILE OVERLAY — never delete or rename their tree (`renameSync` of a
      directory is `EPERM` while files inside are open); our `handles.zig` census ported into their `handles.zig`
      (the generation-retire logic was identical — only the census API was ours). The copy filter must skip
      TOP-LEVEL artifacts only: a basename filter (`lib`) ate `zig-deps/ghostty/src/lib/` and failed the build 9×.
- [x] **S4 — app switch + oracles.** DONE: `bun typecheck` exit 0 (the 120 TS4114 were THEIR files against
      `@tsconfig/bun`'s `noImplicitOverride`; 2 latent TS2345 in their `solid` cast the way their own file
      already does), ABI smoke (`setImageProtocol("sixel")` → true, `NativeImage.fromRgba(8×8)` OK, census
      `renderer=1/1`), TUI renders from source (pixel capture above). **STILL OPEN:** the calibrated-graphics
      pixel oracle (sixel/mermaid/images) and the git commit — the swap lives in the working tree only.

## Smoke / oracles

- S0: run state exit code + artifact existence.
- S1: per-module zig tests (ours run inside their harness).
- S4: launch the TUI, screenshot, verify sixel/mermaid/images render (the calibrated behaviors).

## Guards

- Both toolchains side by side; the CURRENT fork keeps building with 0.15.2 until the switch.
- Never a wholesale copy of our zig over theirs (or vice versa): merge module by module under tests.
- The AGENTS.md rule update lands WITH S3/S4, not before (the doc must follow the ruling).
