# Draggable dialogs with a computed initial position

<!-- intention: dialogs are layout-positioned (centred by flex, no state) and pinned to a quarter of the height -> every dialog is placed by measured size, can be dragged by a grip row, and is re-clamped on resize -->

Owner: «Да именно диалоги плюс мы должны красиво вычислять стартовую позицию.» (2026-09-19)

> **STATUS: PARKED, code not in the tree.** The implementation was written, typechecked (exit 0) and
> built, but **never verified on screen** — two capture attempts landed on the splash. It touches EVERY
> dialog's geometry, and the owner then reported the form as broken, so it was removed from the working
> tree rather than allowed to ride into the next build. The parked source is
> **`.opencode/parked/dialog.draggable.tsx`** (gitignored): copying it over
> `packages/opencode/src/cli/cmd/tui/ui/dialog.tsx` restores the work. Nothing else is needed — the
> change is confined to that ONE file. Re-land it only with a screenshot in hand.

## 1. Current state (grounded)

`packages/opencode/src/cli/cmd/tui/ui/dialog.tsx` — the ONE place a dialog is positioned:

- `:39-47` overlay: `width/height = terminal`, `position="absolute"`, `left=0 top=0`,
  `alignItems="center"`, `paddingTop={dimensions().height / 4}`, dim backdrop, `zIndex=3000`.
- `:49-58` panel: `width = medium 60 / large 88 / xlarge 116`, `maxWidth = terminal − 2`,
  `paddingTop={1}`, `backgroundColor = theme.backgroundPanel`.
- `:29-38` overlay mouse: `onMouseDown` remembers a text selection, `onMouseUp` closes when there was
  none. `:50-53` panel `onMouseUp` stops propagation and clears the flag.

So the position is **derived from the layout every render** — there is no position state to drag.
`alignItems="center"` + that `paddingTop` occurs nowhere else (grep: only `dialog.tsx:41,44`).

The drag idiom already exists in this repo and is the one to copy —
`component/media-image.tsx:546-589`: `type==="down" && button===0` → record `x/y`, `stopPropagation`,
`preventDefault`; `type==="drag"` → `dx/dy` against the last point; `type==="drag-end" || "up"` → end.
Handlers: `onMouseDown` / `onMouseDrag` / `onMouseDragEnd` / `onMouseUp`.

Measurement is available: `Renderable.onSizeChange` (`Renderable.ts:129,1207,1712-1732`) and
`getLayoutNode().getComputedLayout()` (`yoga.ts:584`) give the laid-out `width/height`.

## 2. Design

**Position becomes state; the initial value is computed, not layout-derived.**

- `pos: {x,y} | null` — `null` means "the user has not dragged this dialog", so the position is
  re-derived from the terminal and the MEASURED panel size. Once dragged it is pinned.
- Measured size: `onSizeChange` on the panel → `getLayoutNode().getComputedLayout()` → `{w,h}`.
- Initial position ("красиво"):
  - `w = min(sizeWidth, terminalWidth − 2)` (unchanged rule), `x = floor((terminalWidth − w) / 2)`
    — horizontally centred, which needs no measurement;
  - `y = floor((terminalHeight − h) / 2)` — vertically centred on the MEASURED height, so a tall
    dialog is not pushed off the bottom and a short one is not stranded at a quarter height.
    Before the first measurement `h = 0`; the fallback is the old `height / 4` so nothing jumps more
    than one frame.
- Clamp both axes into `[0, terminal − size]`, re-applied on terminal resize while not dragged.
- **Grip row**: the panel's `paddingTop={1}` becomes a real one-row box (net rows unchanged) holding a
  centred muted grip glyph, with the drag handlers attached to it ONLY. This keeps the drag in ONE
  place for every dialog instead of N header call sites, and keeps drags over list rows inert.
- The position PERSISTS across dialogs — it is deliberately NOT reset on `push`/`replace`: a floating
  window stays where you put it, and a terminal resize re-clamps it instead. Implemented as
  `dragged() === null` meaning "never moved", so the computed centre keeps tracking the terminal
  until the first drag.

## 3. Smoke Tests

- **S1 — compile**: `bun typecheck` (packages/opencode) exit 0. Not a render oracle.
- **S2 — initial position is centred**: open `/agents` in a TUI via cmd_runner
  (`--terminal wt --direct-terminal`, screenshot). The panel's left and right margins must be equal
  (±1 cell) and its vertical margins equal (±1). Baseline to capture FIRST: today it sits at
  `height/4` with a visibly larger bottom margin.
- **S3 — the grip drags**: `cmd_runner send` cannot drag; use the mouse through cua or ask the owner.
  The falsifier: after a drag the panel must stay where released AND survive a re-render (a new
  keystroke must not snap it back to centre). If it snaps back, the position is still derived.
- **S4 — resize clamps**: narrow the terminal while a dialog is open; the panel must remain fully
  on screen. A dialog pinned off-screen is the failure.
- **S5 — no regression to dismissal**: clicking the backdrop still closes; clicking inside does not.

## 4. Risks

- Every dialog gains the grip row (one row, replacing existing padding — no net height change).
- Absolute positioning of the panel must not break backdrop dismissal: the overlay keeps its
  full-size box and its `onMouseDown/onMouseUp`; the panel keeps `stopPropagation` on `onMouseUp`.
- `y` depends on the measured height, which arrives after the first layout pass — hence the
  one-frame fallback rather than a blank frame.
