/**
 * T13a of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md — the render-trace seam must SEE a flicker,
 * and must decide it over what was DRAWN, not over what was written.
 *
 * Owner, 2026-09-24: «Ты бы вообще проверил что оракул написан правильно и учитывает все тонкости рендеринга».
 * The subtleties each get a control here:
 *   - per LINE, not per block: a streaming block changes its text on every delta, so a block-level check can
 *     never see «same text, other style» — the class T11 fixed. The positive control reproduces that bug and
 *     must be caught per line and MISSED per block (both halves asserted);
 *   - drawn, not written: several writes between two frames coalesce; an A -> B -> A inside one frame is
 *     invisible and must not count;
 *   - visibility: a block that is not drawn (culled) cannot flicker for the eye;
 *   - blank flashes and reflows (same text, other height) are their own classes.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { CodeRenderable } from "../Code.js"
import { StyledText } from "../../lib/styled-text.js"
import { RGBA } from "../../lib/RGBA.js"
import { SyntaxStyle } from "../../syntax-style.js"
import {
  analyzeRenderTrace,
  closeRenderTraceFrame,
  setRenderTraceSink,
  type PaintEvent,
  type RenderTraceEvent,
} from "../../lib/render-trace.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let events: RenderTraceEvent[]

beforeEach(async () => {
  const setup = await createTestRenderer({ width: 60, height: 12 })
  renderer = setup.renderer
  renderOnce = setup.renderOnce
  events = []
  setRenderTraceSink((event) => events.push(event))
})

afterEach(() => {
  setRenderTraceSink(null)
  renderer.destroy()
})

const colour = (r: number) => RGBA.fromValues(r, 0.5, 0.5, 1)
const chunk = (text: string, r: number) => ({ __isChunk: true as const, text, fg: colour(r), attributes: 0 })

/**
 * The subject needs a filetype AND a long quiet window. Without a filetype `renderSelf` repaints the buffer
 * PLAIN on every dirty frame (`no-filetype`) — what the first version of the positive control drew, which is
 * why it read 0 (the seam showed it: every `preview` paint was followed by a `no-filetype` one). With a filetype
 * but no window a parse would start and paint over the writes under test. So: the quiet window keeps the parse
 * away while the stream is hot, and what is drawn is exactly what the test wrote.
 */
function subject(id: string) {
  const code = new CodeRenderable(renderer, {
    id,
    content: "",
    filetype: "markdown",
    syntaxStyle: SyntaxStyle.create(),
    streaming: true,
    drawUnstyledText: true,
    quietHighlightMs: 60_000,
    width: 60,
  })
  renderer.root.add(code)
  return code
}

const paintsOf = (id: string) => events.filter((event): event is PaintEvent => event.kind === "paint" && event.id === id)

test("per-write flags: A -> B -> A on unchanged text is a return, the same write twice is redundant", () => {
  const code = subject("flip")
  const styled = (r: number) => new StyledText([chunk("same text on one line", r)])
  code.updateStreamingPreview("same text on one line", styled(1))
  code.updateStreamingPreview("same text on one line", styled(0.2))
  code.updateStreamingPreview("same text on one line", styled(1))
  code.updateStreamingPreview("same text on one line", styled(1))
  expect(paintsOf("flip").map((event) => event.event)).toEqual(["paint", "restyle", "return", "redundant"])
  expect(paintsOf("flip")[2]!.source).toBe("preview")
})

test("POSITIVE control — the T11 bug: a stable line flips style inside a GROWING block; caught per line, missed per block", async () => {
  const code = subject("grow")
  let tail = ""
  for (let i = 0; i < 12; i++) {
    tail += ` word${i}`
    const content = `a stable first line of text\nthe tail keeps growing:${tail}`
    // Even deltas paint the stable line one way (the caller's styling), odd deltas another (the parse).
    code.updateStreamingPreview(content, new StyledText([chunk("a stable first line of text", i % 2 ? 0.2 : 1), chunk(`\nthe tail keeps growing:${tail}`, 0.6)]))
    await renderOnce()
  }
  closeRenderTraceFrame()
  const report = analyzeRenderTrace(events)
  expect(report.frames).toBeGreaterThanOrEqual(12)
  expect(report.lineReturns).toBeGreaterThan(0)
  // The block-level view is BLIND to it: the block's text changed on every write, so no write is a return.
  expect(paintsOf("grow").some((event) => event.event === "return" || event.event === "restyle")).toBe(false)
})

test("NEGATIVE control: the same growth with one style for the stable line draws no line return", async () => {
  const code = subject("steady")
  let tail = ""
  for (let i = 0; i < 12; i++) {
    tail += ` word${i}`
    const content = `a stable first line of text\nthe tail keeps growing:${tail}`
    code.updateStreamingPreview(content, new StyledText([chunk("a stable first line of text", 1), chunk(`\nthe tail keeps growing:${tail}`, 0.6)]))
    await renderOnce()
  }
  closeRenderTraceFrame()
  expect(analyzeRenderTrace(events).lineReturns).toBe(0)
})

test("coalescing: an A -> B -> A inside ONE frame is written but never drawn, so it does not count", async () => {
  const code = subject("coalesce")
  const styled = (r: number) => new StyledText([chunk("a line that is long enough", r)])
  code.updateStreamingPreview("a line that is long enough", styled(1))
  await renderOnce()
  code.updateStreamingPreview("a line that is long enough", styled(0.2))
  code.updateStreamingPreview("a line that is long enough", styled(1))
  await renderOnce()
  await renderOnce()
  closeRenderTraceFrame()
  // The writes DID flip (per-write flag), the eye did not see it (drawn analysis).
  expect(paintsOf("coalesce").some((event) => event.event === "return")).toBe(true)
  expect(analyzeRenderTrace(events).lineReturns).toBe(0)
})

test("visibility, blank flashes and reflows are decided over drawn frames (synthetic trace)", () => {
  const line = (style: string): Array<[string, string, number]> => [["t1", style, 20]]
  const drawn = (frame: number, serial: number, blank: boolean, height: number, style: string) =>
    ({ kind: "drawn", t: frame, frame, serial, id: `b${serial}`, blank, y: 0, height, sig: style, textSig: "x", lines: line(style) }) as const
  const frame = (frame: number, drawnSerials: number[]) => ({ kind: "frame", frame, drawn: drawnSerials }) as const
  const report = analyzeRenderTrace([
    // Block 1 flips A -> B -> A while it is NOT drawn (culled): invisible, no return.
    drawn(1, 1, false, 3, "A"),
    frame(1, [1]),
    drawn(2, 1, false, 3, "B"),
    frame(2, []),
    drawn(3, 1, false, 3, "A"),
    frame(3, [1]),
    // Block 2: text, blank, text — one blank flash; then the same text at another height — one reflow.
    drawn(4, 2, false, 2, "C"),
    frame(4, [2]),
    drawn(5, 2, true, 2, "C"),
    frame(5, [2]),
    drawn(6, 2, false, 2, "C"),
    frame(6, [2]),
    drawn(7, 2, false, 3, "C"),
    frame(7, [2]),
  ])
  expect(report.lineReturns).toBe(0)
  expect(report.blankFlashes).toBe(1)
  expect(report.reflows).toBe(1)
})
