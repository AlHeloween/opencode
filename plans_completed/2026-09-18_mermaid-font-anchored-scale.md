<!-- intention: mermaid diagram scale is unpredictable and unrelated to the terminal font -> label text is a fixed number of terminal rows tall, in every diagram -->

# Mermaid scale anchored to the terminal font, not to the diagram width

```yaml
status: fixed and mutation-tested, 2026-09-18
scope: packages/opencode/src/util/fit-image.ts, util/mermaid.ts, cli/cmd/tui/component/media-image.tsx
raised_by: Alexander — "mermaid рендерится непропорционально размеру шрифта, масштаб непредсказуем"
```

## Smoke Tests

- Baseline [Exact]: the four new end-to-end assertions fail against the old
  width-filling path (verified by disabling the new branch).
- Post-fix [Exact]: `test/util/mermaid.test.ts` 18/0, `test/util/fit-image.test.ts`
  22/0, image/tui adjacent suites 69/0, `bun typecheck` clean.

## Root cause — measured, not reasoned

`resvgOptionsForSvg` fitted every diagram to **exactly** the available width
(`allowUpscale: true`, comment: "always fill the width budget"). Mermaid's label
font is a constant — probed on real wasm output, `font-size` is **14 CSS px** in
every diagram and theme tested. Natural width, however, tracks node count.

So apparent text size was `14 × maxWidth / naturalWidth` — a function of the
*diagram*, not of the terminal. Measured at a 1200px budget (120 cols × 10px):

| Diagram | Natural width | Old scale | Label rendered at |
|---|---|---|---|
| 2 nodes | 123 px | **9.74×** | **136 px** — a glyph seven rows tall |
| 6 nodes | 155 px | 7.76× | 109 px |
| 12-node chain | 2755 px | **0.44×** | **6 px** — smaller than one cell |

A **22× spread** in apparent text size, driven entirely by node count.

The hardcoded `FALLBACK_CELL_W = 18` was a red herring: the native path already
receives the measured cell width from `CSI 16t` via `media-image.tsx`. The
constant only applies to the PNG symbol fallback.

## Fix

New pure function `fitFontAnchoredSize` in `fit-image.ts`:

```
scale = min( cellHeight × labelCells / srcFontPx ,  maxWidth / srcWidth )
```

The first term anchors the label to the terminal cell, so it tracks the user's
font size and is identical across diagrams. The second only **clamps** — width
stops being a target and becomes a limit. `labelCells` defaults to 1: one line
of diagram text occupies one terminal row.

`parseSvgFontSize` reads the intrinsic size from the SVG (most frequent
`font-size`, ties to the smaller one) rather than assuming 14, so a theme that
changes it still scales correctly. `media-image.tsx` now passes the measured
`cellHeight` into the budget.

After:

| Diagram | New scale | Label | Clamped |
|---|---|---|---|
| 2 nodes | 1.43× | **20 px** | no |
| 6 nodes | 1.43× | **20 px** | no |
| 12-node chain | 0.44× | 6 px | yes |

Everything that fits renders its text at exactly one cell. The wide chain still
shrinks, because 2755 px genuinely does not fit 1200 px — but that is now the
only reason a diagram is ever shrunk, and it is explainable.

## Oracle

Ten unit tests on `fitFontAnchoredSize` / `parseSvgFontSize`, plus six
end-to-end tests over real wasm output in `mermaid.test.ts`, including the
central invariant: *two diagrams of different natural width render their labels
at the same size*, and *doubling the terminal font doubles the rendered label*.

Mutation: disabling the anchored branch fails 4 of the 6 end-to-end tests.

## Residuals — deliberately not done

- **A diagram wider than the terminal is still shrunk to fit** and can end up
  below one cell (the 12-node chain at 6 px). The alternative is to render at
  the anchored scale and let the user pan — `MediaImage` already supports
  `interactive` wheel-zoom and drag-pan. That is a product choice about what a
  too-wide diagram should do by default, so it is left open rather than decided
  here.
- **The PNG symbol fallback keeps width-filling.** It has no `CSI 16t` geometry
  to anchor to, and inventing a cell size there is how `FALLBACK_CELL_W` became
  misleading in the first place.
- `labelCells` is exposed but nothing sets it yet; it is the single taste knob
  if one terminal row turns out to be too small in practice.

## Not this — separate deliverables

Two failures in `test/util` predate this work, verified with the change
stashed: `validateCodeSyntax > rejects TypeScript with syntax error (gibberish
token)` and `wasm-embedded > declares a unique path for every embedded asset`.
