<!-- intention: a Textarea resize never reaches the edit buffer, so text is not re-wrapped -> resizing re-wraps and viewport/selection stay correct -->

# Textarea resize did not re-wrap — one field answering two questions

```yaml
status: fixed and mutation-tested, 2026-09-18
scope: packages/opentui/packages/core/src/Renderable.ts
closed: 4 failures (2 scroll + 2 selection), package 81 -> 77
```

## Smoke Tests

- Baseline [Exact]: `bun test src/renderables/__tests__/Textarea.scroll.test.ts` → 19 pass / 2 fail.
- Post-fix [Exact]: 21 pass / 0 fail; `Textarea.selection.test.ts` 47 pass / 0 fail;
  graphics trio (`image-renderable`, `renderer.image-protocol`, `renderer.kitty-flags`)
  27 pass / 0 fail; full package 5065 pass / 77 fail (was 5062 / 81).

## Root cause

`_widthValue` answered two different questions at once.

| Question | Who asks | What it needs |
|---|---|---|
| "what size do I draw at *right now*?" | graphics — Kitty/Sixel stamps, calibrated mermaid | the **declared** size, readable immediately after assignment, before the next layout pass |
| "did the size change?" | `updateFromLayout` → `onLayoutResize` → `onResize` | the size the **last layout** computed |

The width/height setters eagerly wrote the declared value into `_widthValue`
(added by `4f7d3bd1b1`, the hybrid scroll-locked graphics commit). Then
`updateFromLayout` read that same field as `oldWidth`. So `editor.width = 80`
made 80 its own "old" value: `sizeChanged` was false for the very resize that
had just been requested, `onResize` never fired, `setViewportSize` was never
called, `wrap_width` never changed, and the text was never re-wrapped —
`totalVirtualLines` stayed at 105 across a 10 → 80 widening.

## Fix

Split the two meanings. `_widthValue` / `_heightValue` keep the eager
draw-time behaviour untouched; new private `_laidOutWidth` / `_laidOutHeight`
carry the last laid-out size and are the only input to `sizeChanged`. Both are
seeded from a numeric declared size in the constructor, so first-frame
behaviour is unchanged. **Nothing was removed** — the graphics assignments
stand verbatim.

## Oracle — both directions mutation-tested

New `describe("Renderable - declared size vs laid-out size")` in
`src/tests/renderable.test.ts`, three tests:

| Mutation | Which test fails |
|---|---|
| restore the shared field (the original defect) | "declaring a new size still fires onResize once layout confirms it" |
| delete the setter's eager sync (an "align to upstream" edit) | "a numeric width is readable immediately, before the next layout pass" |

Both were run and both failed as predicted. The third test pins that an
unchanged size stays quiet, so the fix cannot be re-broken by making every
frame resize.

This is the first test either contract has ever had. The graphics half had
none, and this package declares no `test:ci`, which is exactly how the setter
hack survived unguarded long enough to break resize.

## Correction — the selection contract question was wrong

The earlier version of this plan warned that
`Textarea.selection.test.ts` (2 failures) needed upstream's **inclusive**
selection contract and four new native symbols, and called it a product
decision. That was wrong: those 2 failures were the same resize defect
(selection after a wrap-width change) and closed with this fix. Our selection
contract is fine. Nothing is to be ported.

## Not this — separate deliverables

- `CodeRenderable > streaming content update schedules render and starts
  highlighting when renderer is idle` — 1 failure, verified present with this
  change stashed, so not a regression from it.
- `borrowed pointer call sites` — 3 failures.
- Remaining 73 are the audio cluster, parked by Alexander to be done together
  with video.
- `tsc -p tsconfig.json` reports errors in `src/tests/yoga-upstream/*` because
  the tsconfig pulls in test files without bun test types. Pre-existing, unrelated,
  still a deliverable.

## Note on method

Upstream (`external/opentui-0.5.11`) was used **only** to locate the seam —
`Renderable.ts` has 16 hunks against it. It is not a defect list: upstream has
no Kitty/Sixel path, no `Image.ts` modes, no native Sixel backend and no
calibrated mermaid, so for this file "differs from upstream" means "we added
it". Not one line was taken from upstream; the fix is derived from our own
code's logic and proven by our own tests.
