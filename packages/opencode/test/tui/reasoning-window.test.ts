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
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { reasoningView, reasoningWindow } from "../../src/cli/cmd/tui/routes/session/text-segments"
import { parseMarkdownIncremental, type ParseState } from "../../../opentui/packages/core/src/renderables/markdown-parser"

// Heavy: the parser pins below re-lex a ~6 000-character window per delta, thousands of deltas in all,
// so the FILE carries the timeout — bun's 5 s default turns a loaded machine into a red that says
// nothing about the code.
setDefaultTimeout(20_000)

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

/**
 * T1's acceptance is `reuseCount > 0 across deltas between rotations`, and it is checkable only on the
 * string the markdown is actually fed — so these pins run the REAL `parseMarkdownIncremental` over
 * `reasoningView`'s output. The legacy representation is kept as a POSITIVE CONTROL: if it passed these
 * assertions too, they would prove nothing about the fix.
 */
describe("reasoningView → parseMarkdownIncremental", () => {
  /** Tokens carried over by REFERENCE — the parser's own definition of reuse (`markdown-parser.ts:37`). */
  const reusedTokens = (prev: ParseState, next: ParseState) =>
    prev.tokens.filter((token) => next.tokens.includes(token)).length

  test("between rotations the body only APPENDS, and the parser keeps its tokens", () => {
    let text = stream(60) // ~8 100 characters: past the display cap, so the window is active
    let body = reasoningView(text, MAX, false).body
    let state = parseMarkdownIncremental(body, null)

    const rotations: number[] = []
    const relexed: number[] = []
    let minReuse = Number.POSITIVE_INFINITY

    for (let delta = 1; delta <= 2_400; delta++) {
      text += "y"
      const nextBody = reasoningView(text, MAX, false).body
      const nextState = parseMarkdownIncremental(nextBody, state)
      if (!nextBody.startsWith(body)) {
        // A rotation is the ONE event an append-only window is allowed to have.
        rotations.push(delta)
      } else {
        const reuse = reusedTokens(state, nextState)
        if (reuse === 0) relexed.push(delta)
        minReuse = Math.min(minReuse, reuse)
      }
      body = nextBody
      state = nextState
    }

    expect(rotations.length).toBeGreaterThan(0) // the window is not frozen: it does rotate…
    expect(rotations.length).toBeLessThan(10) // …but not on every delta
    expect(relexed).toEqual([]) // and between rotations nothing is re-lexed from offset 0
    expect(minReuse).toBeGreaterThan(0) // the leading tokens survive every non-rotation delta
  })

  test("CONTROL: the legacy representation (counter first, slice(-MAX)) fails both assertions", () => {
    // The falsifier the plan demands: an oracle that cannot fail proves nothing.
    const legacy = (value: string) =>
      `*Thinking:* … ${value.length - MAX} characters omitted — the latest ${MAX} shown\n\n${value.slice(-MAX)}`

    let text = stream(60)
    let body = legacy(text)
    let state = parseMarkdownIncremental(body, null)

    let appended = 0
    let reused = 0
    for (let delta = 0; delta < 200; delta++) {
      text += "y"
      const nextBody = legacy(text)
      const nextState = parseMarkdownIncremental(nextBody, state)
      if (nextBody.startsWith(body)) appended++
      reused += reusedTokens(state, nextState)
      body = nextBody
      state = nextState
    }

    expect(appended).toBe(0) // the counter rewrites the head on every delta…
    expect(reused).toBe(0) // …so the parser reuses nothing: the whole window is re-lexed each time
  })

  test("the counter is NOT a markdown token — the body's head is stable text", () => {
    const long = stream(60)
    const { body, omitted } = reasoningView(long, MAX, false)
    expect(body).not.toContain("characters omitted")
    expect(omitted).toContain("characters omitted")
    expect(body.startsWith("*Thinking:*\n\n")).toBe(true)

    const short = stream(3)
    expect(reasoningView(short, MAX, false)).toEqual({ body: `*Thinking:* ${short}`, omitted: "" })
  })
})
