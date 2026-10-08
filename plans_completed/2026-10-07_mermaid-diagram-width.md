# Mermaid diagram width is габариты, not a clamp

<!-- intention: a mermaid diagram's apparent text size was decided by a font-anchored scale clamped to an 80-column budget, so any diagram wider than the clamp rendered its labels below one terminal row -> the diagram is DRAWN at the window's own width and its height is never budgeted, so nothing in the pipeline resizes a rendered diagram -->

**Status:** COMPLETE — closed 2026-10-08 (boxes earned by `de33b3e7c9`; scratch probes relocated to `experiments/2026-10-07_mermaid-diagram-width/`)

## Why

Owner, 2026-10-07, verbatim: «рендер svg ничего ресайзить не должен, в mermaid max width ширина в tui.
Height вообще никак не ограничиваем», «Ты просто задаешь ограничитель, а не габариты»,
«ЗАДАЙ МАКСИМАЛЬНУЮ ШИРИНУ. БЕЗ ВЫСОТЫ».

## What was wrong — measured

| defect | evidence |
|---|---|
| The width budget was 80 terminal columns, never the window's own width | `media-image.tsx`: `MAX_COLS = 80`; `mediaImageCellBounds` = `Math.min(MAX_COLS, terminalCols)` |
| The rasteriser computed its own scale, `scale = min(cellHeight/fontPx, maxWidth/naturalWidth)`, so every diagram wider than the clamp got labels smaller than one terminal row | `mermaid.ts` → `resvgOptionsForSvg` → `fitFontAnchoredSize` |
| The mermaid renderer cannot be given a width at all — the knob is not missing, it is absent | WASM wrapper `src/lib.rs` forwards only `theme` + `layout`; `render.width`/`height` are dropped. `useMaxWidth`, `preferredAspectRatio`, `maxAspectRatio`, `wrapMinGroups` all measured as no-ops on the SVG; only `flowchart.nodeSpacing`/`rankSpacing` moved anything (748→618). Probe: `experiments/2026-10-07_mermaid-font-probe/probe-width.ts` |

## Change

- `src/util/mermaid.ts` — `resvgOptionsForSvg` sets width and nothing else: `fitTo: { mode: "width", value: mermaidPixelBudget(budget).maxWidth }`. No font anchor, no clamp, no height.
- `src/cli/cmd/tui/component/media-image.tsx` — `mediaImageCellBounds` gives a `layout: "diagram"` the window's own width; attachments keep the 80-column decode cap (it is a decode budget, not a diagram's габариты).
- `src/util/fit-image.ts` — deleted the superseded helpers `fitFontAnchoredSize` and `fitToWidthSize` with their tests; a parked copy of the killed design is what a later cycle would re-wire.

## Smoke Tests

- [x] `bun test test/util/mermaid.test.ts test/tui/media-image-size.test.ts` — 32 pass / 0 fail
- [x] `bun test test/util/fit-image.test.ts test/util/mermaid.test.ts test/tui/media-image-size.test.ts` — 43 pass / 0 fail, 112 expect() calls
- [x] `bun run typecheck` (tsgo --noEmit) from `packages/opencode` — exit 0
- [x] `pwsh -File _build.ps1` — exit 0, `Smoke test passed: 10.0.1221`, embedded `reasoning_prompt.txt` asset present

## Residual

- A diagram whose natural width exceeds the window still loses apparent text size: the drawing must scale to
  fit, and this renderer exposes no reflow knob (measured above). Holding label size there needs a
  renderer-side width/reflow option or a viewer that pans instead of fitting — an upstream question, not a
  pipeline one.
- The investigation's scratch probes (`probe2.ts` … `probe11.ts`, their PNGs and `probe10.out`) moved out of `packages/opencode/` and the repo root into `experiments/2026-10-07_mermaid-diagram-width/` on 2026-10-08 — they were untracked, so nothing entered git history.
