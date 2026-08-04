# Raster viewport State Vector Manifest

Framework: ADID 15.4.3. This is a stateless briefing for the single raster
viewport objective. It intentionally uses no canonical node hash, version
chain, or mandatory envelope transport; 15.4.3 requires verifiable state and
oracle evidence, not a prescribed manager or serialization format.

## 1. Goal and scope

Goal: make graphics and text render as one scroll-coherent OpenTUI scene in a
Windows Terminal SIXEL session.

Scope: the OpenTUI raster viewport and its direct Windows Terminal validation.
It does not change the Mermaid layout engine or replace standard ANSI rendering
outside the raster capability path.

Semantic vector: `["unified scene", "scroll coherence", "native graphics"]`
with weights `[0.40, 0.35, 0.25]`.

## 2. Current state and artifacts

- `E` safe eligibility: done; native build, library build, and targeted tests
  passed.
- `R` final composition input: done.
- `O` one native output image: done.
- `C` raster caret: done.
- `T` text clusters: done; font face chain, non-spacing marks, geometric block
  fills, and tofu for missing glyphs have native oracles.
- `S` UI visual fidelity: done; inverse selection, full-block scrollbar, and
  box-drawing geometry have a native RGBA oracle.
- `M` joint media/text pass: done; media is row-sliced into the cell grid with
  alpha mask in the same walk as glyphs (no post-pass plane).
- `H` native harness: done; enable/emit/disable hybrid restore, oversized
  geometry reject, and FPS coalesce tests pass.
- `W` direct Windows Terminal oracle: hybrid production path proven in WT
  (scroll-lock stamps, mermaid width-fit, footer clip). Full-viewport SIXEL
  raster refused; default raster enable deferred (Kitty / dirty-rect).
- `P` bounded transport: done; pixel cap `1920×1080`, FPS floor ~60 Hz with
  latest-frame coalesce, RGBA encoded-byte policy.

Artifacts: `packages/opentui/packages/core`, the raster viewport plan, and
native test fixtures. Recorded evidence: joint-pass + scroll-shift oracles;
full suite re-run after M.

## 3. Task definition

| Task | Weight | Dependencies | State | Next exact transition |
|---|---:|---|---|---|
| E — safe eligibility | 0.10 | — | done | None. |
| R — final composition input | 0.15 | E | done | None. |
| O — one native output image | 0.15 | E, R | done | Direct Windows Terminal proof. |
| C — raster caret | 0.10 | O | done | Blink scheduler when native mode is admitted. |
| T — text clusters | 0.12 | R | done | None. |
| S — UI styles | 0.08 | R | done | None. |
| M — joint media/text | 0.15 | R, O | done | None. |
| H — native harness | 0.10 | R, C, M | done | None. |
| W — Windows Terminal proof | 0.10 | O, C, H, M | done (hybrid) / deferred (default raster) | Hybrid WT path proven; full-viewport SIXEL raster not default-admitted. |
| P — transport bounds | 0.05 | O | done | None. |

## 4. Verification criteria

1. A task is done only after its named oracle passes; a commit ID alone is not
   an oracle.
2. `W` requires direct Windows Terminal evidence; source builds do not replace
   it.
3. Raster mode cannot become the default before Kitty/`W` default-admission
   evidence; hybrid production path is already admitted for SIXEL WT.
4. The production hybrid scene must scroll as one logical viewport: text cells
   + Sixel stamps share layout; full-viewport SIXEL raster is not the path.

Named test cases: native build, library build, targeted image-renderer tests,
native suite (includes raster style/harness/FPS), hybrid scroll-lock oracles,
and direct Windows Terminal hybrid Mermaid/input evidence.

Named oracles: `bun run build:native:dev`; `bun run build:lib`; targeted image
renderer tests; `bun run test:native`; hybrid WT validation (scroll-lock,
footer clip, width-fit mermaid). Default full-raster admission remains deferred.

Evidence requirements: preserve command output for every named oracle; record
the build or commit that produced the tested artifact; attach screenshot and
interactive observations to `W`.

## 5. Epistemic claim ledger

| Claim | Mark | Evidence / boundary |
|---|---|---|
| Native RGBA composition receives cells, media, and caret in one pass. | Exact | Native fixture and targeted renderer tests. |
| Inverse selection, scrollbar blocks, and box borders paint in the viewport. | Exact | `raster viewport paints selection inverse, scrollbar block, and box borders`. |
| Missing glyphs fall back to a visible tofu rect via the font chain. | Exact | `raster viewport draws tofu for missing glyphs` + font-chain null test. |
| Media is joint-pass cell-grid with alpha mask (row-sliced with text). | Exact | `joint-pass media is row-sliced…` + `scroll shift keeps media strips locked to text rows`. |
| Raster FPS policy coalesces non-forced frames under ~60 Hz. | Exact | `renderer - raster FPS policy coalesces latest frames`. |
| Oversized geometry is rejected before raster mode enables. | Exact | `renderer - raster geometry rejects oversized pixel budget`. |
| Disable raster restores hybrid one-DCS sixel path. | Exact | `renderer - raster mode enable, emit, disable restores hybrid sixel path`. |
| Windows Terminal presents a coherent raster viewport. | Unknown | Requires `W` direct-session screenshot and interaction evidence. |
| HarfBuzz is necessary for all final text fidelity. | Inferred | Bitmap + geometric path covers UI; complex scripts unproven without shaping. |
| SIXEL transport needs an explicit coalescing policy. | Exact | FPS coalesce + pixel/byte caps are implemented and tested. |

## 6. Certified transition state

`safety_critical: false`. The work changes local rendering only; no external
physical action, certification envelope, or simulation report is required.

## Smoke tests

Baseline and post-change acceptance are maintained in
[2026-07-29-raster-viewport-renderer.md](2026-07-29-raster-viewport-renderer.md).
Each new task records its baseline before implementation and attaches direct
oracle output before it is marked done.
