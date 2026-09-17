<!-- intention: a Textarea resize never reaches the edit buffer, so text is not re-wrapped -> resizing re-wraps and viewport/selection stay correct -->

# Textarea resize does not re-wrap — 2 of the 4 remaining non-audio failures

```yaml
status: diagnosed to the exact missing call, fix not written
raised: 2026-09-18
scope: packages/opentui/packages/core/src/Renderable.ts (layout propagation)
```

## Smoke Tests

- Baseline [Exact]: `bun test src/renderables/__tests__/Textarea.scroll.test.ts` →
  2 fail. The whole package is at **81** after the markdown fix (77 audio +
  4 Textarea).
- Post-fix oracle: those 2 green, package total down to 79, and the graphics
  trio still 27 pass / 0 fail.

## What fails

| Test | Assertion |
|---|---|
| `should keep content at bottom when resizing from narrow wrapped to wide unwrapped` | `totalVirtualLinesWide < totalVirtualLinesNarrow` — got **105 vs 105** |
| `should allow scrolling and selecting last line immediately after resize from wide to narrow` | `> 20`, got exactly `20` |

`Textarea.scroll.test.ts` is **byte-identical to upstream 0.5.11** (0 hunks), so
this is our defect and upstream's implementation passes the same test.

## Diagnosis — the resize never arrives

The virtual line count is unchanged after widening 10 → 80, i.e. the text was
never re-wrapped. Traced by probe, each step measured:

1. `EditBufferRenderable.onResize` → **never fires** (probe printed nothing).
2. Therefore `editorView.setViewportSize` is never called, `wrap_width` never
   changes, and `virtual_lines_dirty` is never set.
3. `Renderable.updateFromLayout` on the EditBufferRenderable → **never called
   either** (probe on the child printed nothing). So it is not a size-change
   guard rejecting the update; the layout pass does not reach the child at all.

## Ruled out by measurement

- **The native side is correct.** `text-buffer-view.zig:239` `setViewport`
  updates `wrap_width` and sets `virtual_lines_dirty` whenever the width
  differs, and `editor-view.zig:380` forwards `setViewportSize` to it. The DLL
  was rebuilt from this source on 2026-09-17.
- **Not the NaN guard.** Our `Renderable.ts:1129` differs from upstream by
  falling back to the old size when Yoga reports NaN (a graphics-era fix: "used
  to poison image slots"). Probed — no NaN occurs in this test, so the guard
  never engages here. It remains a latent concern elsewhere, because it turns
  "size unknown" into "size unchanged", which would swallow a real resize.
- **Not `Textarea.ts` or `EditBufferRenderable.ts`.** Both differ from upstream
  only by `override` keywords (cosmetic, from the same `3b07819193` grab-bag).
- **Not `onLayoutResize`.** Byte-identical to upstream.

## Next cut

`Renderable.ts` has 16 hunks against upstream and is where layout propagates.
Find which of them governs whether a child's `updateFromLayout` runs during a
parent-initiated resize. The test drives it via `editor.width = 80` followed by
`root.yogaNode.calculateLayout(80, 24)`, so the question is what walks the tree
after `calculateLayout`.

## The other two Textarea failures are NOT this

`Textarea.selection.test.ts` differs from upstream by 30 hunks and upstream is
+558 lines, because upstream **changed the selection contract to inclusive** —
their version of `should maintain exact same text selected after wrap width
changes` expects `"BBBBB CCCCC "` with a trailing space and a comment reading
"Inclusive selection: cells 6..17 … plus the space under the pointer", where
ours expects `"BBBBB CCCCC"`.

Adopting that needs new native symbols (`editorViewSetSelectionInclusive`,
`editorViewSetSelectionOccupancy`, `editorViewConvertSelectionToCell`,
`textBufferViewGetSelectionOccupancy`) and changes what a drag selects. **That
is a product decision, not a bug fix** — do not port it silently.
