/**
 * T1 of the flicker plan — the reasoning window is APPEND-ONLY.
 *
 * The defect, measured 2026-09-22: `ReasoningPart` rendered `text.slice(-6_000)` and put the
 * omitted-count as the FIRST markdown token. `parseMarkdownIncremental` matches tokens strictly from
 * offset 0, so on every delta both the counter and the window start moved and `reuseCount` collapsed
 * to 0 — the whole tail was re-lexed per delta, and an append-only stream rendered as
 * replace-head + append-tail. The counter now renders outside the markdown; the window start
 * quantises to block boundaries.
 *
 * The falsifier is the RATIO, not a snapshot: a per-delta window moves its start on every delta of a
 * synthetic stream; a quantised one moves a handful of times over the same stream.
 */
import { describe, expect, test } from "bun:test"
import { reasoningWindow } from "../../src/cli/cmd/tui/routes/session/text-segments"

const MAX = 6_000

/** A live reasoning stream's shape: paragraph-sized blocks, appended character by character. */
const stream = (blocks: number) =>
  Array.from({ length: blocks }, (_, i) => `paragraph ${i} ${"x".repeat(120)}`).join("\n\n") + "\n\n"

describe("reasoningWindow", () => {
  test("between rotations the start does NOT move — that is what lets the parser reuse the prefix", () => {
    const base = stream(60) // ~8 000 characters, past the display cap
    let text = base
    let previous = reasoningWindow(text, MAX, false).start
    let moves = 0
    for (let i = 0; i < 2_500; i++) {
      text += "y"
      const start = reasoningWindow(text, MAX, false).start
      if (start !== previous) moves++
      previous = start
    }
    // The old `slice(-MAX)` moved the start on EVERY delta (2 500 moves here). The quantised window
    // rotates once per block: it must move (it is not frozen) and must not move per delta.
    expect(moves).toBeGreaterThan(0)
    expect(moves).toBeLessThan(10)
  })

  test("a rotation lands on a block boundary, never mid-paragraph", () => {
    const text = stream(60)
    const { start, omitted } = reasoningWindow(text, MAX, false)
    expect(omitted).toBe(start)
    expect(start).toBeGreaterThan(0)
    // The slice begins right after a blank line — the paragraph stays whole.
    expect(text.slice(start - 2, start)).toBe("\n\n")
  })

  test("at the end the EXACT tail is taken once — no deltas remain to re-lex", () => {
    const text = stream(60)
    expect(reasoningWindow(text, MAX, true)).toEqual({ start: text.length - MAX, omitted: text.length - MAX })
  })

  test("reasoning inside the cap is untouched — whole text, no counter", () => {
    const short = stream(3)
    expect(short.length).toBeLessThan(MAX)
    expect(reasoningWindow(short, MAX, false)).toEqual({ start: 0, omitted: 0 })
  })
})
