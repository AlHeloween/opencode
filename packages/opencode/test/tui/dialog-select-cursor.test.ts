import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

/**
 * Owner, 2026-09-29: «когда выбираем модель из списка - выбрали, курсор сбрасывается на
 * начало». The /agents form re-creates itself after every in-place action and restores its
 * row through `cursorValue`; the restore moved the HIGHLIGHT but never scrolled the list,
 * so returning from the model picker for a row below the fold showed the TOP of the dialog.
 *
 * Pinned at the WRITE site (same shape as `fill-layers.test.ts` and `agent-selection.test.ts`):
 * the behavioural half lives inside a Solid render this suite does not mount — a table on a
 * helper would prove the helper, not the effect, which is exactly how `setCursor` without a
 * scroll shipped past a green suite.
 */
describe("DialogSelect cursor restore scrolls to the row", () => {
  const SOURCE = fs
    .readFileSync(path.join(import.meta.dir, "../../src/cli/cmd/tui/ui/dialog-select.tsx"), "utf8")
    .replace(/\r\n/g, "\n")

  /** Slice one region out of the source. Throws when a marker is missing — a broken probe
   *  must be loud, never silently permissive. */
  function between(from: string, to: string): string {
    const start = SOURCE.indexOf(from)
    if (start < 0) throw new Error(`the probe is BLIND, not the code: ${from} is not in the file`)
    const end = SOURCE.indexOf(to, start)
    if (end < 0) throw new Error(`the probe cannot delimit ${from} — fix the instrument, not the code`)
    return SOURCE.slice(start, end)
  }

  const CURSOR_EFFECT = between("() => props.cursorValue,", "let input: InputRenderable")

  test("the slice is not blind — it finds the cursorValue effect", () => {
    expect(CURSOR_EFFECT).toContain("cursorValue")
    expect(CURSOR_EFFECT).toContain("setCursor(index)")
  })

  test("the cursorValue effect SCROLLS to the restored row, deferred past mount", () => {
    // `setCursor` alone leaves the viewport at the top: the marker moves, the list does not.
    expect(CURSOR_EFFECT).toContain("moveTo(")
    // Deferred, because at effect time the scrollbox may not be mounted yet — the same
    // reason the `props.current` effect defers its moveTo.
    expect(CURSOR_EFFECT).toContain("setTimeout(")
  })
})
