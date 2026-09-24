/**
 * T11a of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md — can the replay SEE two style sources?
 *
 * `stream-replay.test.ts` reported `flickered=0` and even `oneWay=0`. Read against its own code, that zero
 * had three independent reasons to be zero whatever the renderer did:
 *   1. its stylesheet has ONE entry (`default`), so marked's styling and tree-sitter's styling resolve to
 *      the same colour — two sources are indistinguishable by construction;
 *   2. its classifier stores DISTINCT signatures (`if (!order.includes(signature)) push`), so a return
 *      A -> B -> A is recorded as [A, B] — a "one-way switch" — although its header promises to catch it;
 *   3. it waits one macrotask between passes and never counts tree-sitter completions, so it cannot say
 *      whether the second source ever landed.
 * This file removes all three: a stylesheet with DISTINCT scopes (the names the TUI theme uses,
 * `opencode/src/cli/cmd/tui/context/theme.tsx:953-1193`), a classifier that counts RETURNS, the live
 * cadence (a frame right after the delta AND one ~25 ms later, the TUI's delta debounce, where a parse
 * result lands), and a pass-through count of `highlightOnce` completions.
 *
 * Powers: a NEGATIVE control (the flat stylesheet cannot show a return) and a POSITIVE control (the
 * stylesheet swapped under fixed text MUST show returns) bracket the measurement. The measured count on
 * the production configuration (coalesced, no quiet window) is printed and recorded in the plan; the
 * assertions are instrument health only, so a fix moves the number without rewriting this file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test"
import { MarkdownRenderable } from "../Markdown.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { TreeSitterClient } from "../../lib/tree-sitter/index.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
import type { CapturedFrame } from "../../types.js"

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "reasoning-stream.json"), "utf8")) as {
  source: string
  deltas: string[]
}
const deltas: string[] = fixture.deltas

setDefaultTimeout(180_000)

/** The TUI's delta debounce (`context/sync.tsx`, DELTA_DEBOUNCE_MS = 25): the gap a parse result lands in. */
const DELTA_GAP_MS = 25

const c = (r: number, g: number, b: number) => RGBA.fromValues(r, g, b, 1)
const richStyle = SyntaxStyle.fromStyles({
  default: { fg: c(0.85, 0.85, 0.85) },
  "markup.heading": { fg: c(1, 0.6, 0.2), bold: true },
  "markup.heading.1": { fg: c(1, 0.5, 0.1), bold: true },
  "markup.heading.2": { fg: c(1, 0.55, 0.15), bold: true },
  "markup.heading.3": { fg: c(1, 0.6, 0.2), bold: true },
  "markup.bold": { fg: c(1, 1, 1), bold: true },
  "markup.strong": { fg: c(1, 1, 1), bold: true },
  "markup.italic": { fg: c(0.8, 0.8, 1), italic: true },
  "markup.list": { fg: c(0.4, 0.8, 1) },
  "markup.quote": { fg: c(0.6, 0.6, 0.6), italic: true },
  "markup.raw": { fg: c(0.5, 1, 0.5) },
  "markup.raw.block": { fg: c(0.5, 1, 0.5) },
  "markup.raw.inline": { fg: c(0.3, 0.9, 0.3) },
  "markup.link": { fg: c(0.3, 0.6, 1), underline: true },
  "markup.link.label": { fg: c(0.4, 0.7, 1) },
  "markup.link.url": { fg: c(0.3, 0.5, 0.9), underline: true },
  "markup.strikethrough": { fg: c(0.6, 0.6, 0.6) },
})
const flatStyle = SyntaxStyle.fromStyles({ default: { fg: c(0.85, 0.85, 0.85) } })

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureSpans: () => CapturedFrame
let treeSitterClient: TreeSitterClient
let completions = 0

beforeAll(async () => {
  const dataPath = join(tmpdir(), "tree-sitter-markdown-renderable-test-data")
  await mkdir(dataPath, { recursive: true })
  treeSitterClient = new TreeSitterClient({ dataPath })
  await treeSitterClient.initialize()
  // Pass-through count of parse results actually delivered — nothing is replaced.
  const highlightOnce = treeSitterClient.highlightOnce.bind(treeSitterClient)
  treeSitterClient.highlightOnce = async (...args: Parameters<typeof highlightOnce>) => {
    const result = await highlightOnce(...args)
    completions++
    return result
  }
})

afterAll(async () => {
  await treeSitterClient.destroy()
})

beforeEach(async () => {
  const setup = await createTestRenderer({ width: 60, height: 40 })
  renderer = setup.renderer
  renderOnce = setup.renderOnce
  captureSpans = setup.captureSpans
})

afterEach(() => {
  renderer.destroy()
})

type Line = CapturedFrame["lines"][number]
const lineText = (line: Line) => line.spans.map((span) => span.text).join("")
const lineSignature = (line: Line) => JSON.stringify(line.spans.map((span) => [span.text, span.fg, span.bg, span.attributes]))

/**
 * Per line TEXT, the signature sequence in frame order. A text change is excluded by construction (the
 * key IS the text). One change is a one-way switch (unstyled -> styled, the designed first parse); a
 * change BACK to a signature already seen is a return — a repaint from a second source.
 */
function classify(frames: CapturedFrame[]) {
  const history = new Map<string, string[]>()
  // For the report only: which PHASE each signature of a line was seen in — even frame index = right
  // after the delta (the caller's styling), odd = one delta gap later (where a parse result lands).
  const phases = new Map<string, Map<string, { afterDelta: number; afterGap: number; spans: Line["spans"] }>>()
  frames.forEach((frame, index) => {
    const seen = new Map<string, Line>()
    for (const line of frame.lines) {
      const text = lineText(line).trimEnd()
      if (text) seen.set(text, line)
    }
    for (const [text, line] of seen) {
      const signature = lineSignature(line)
      const order = history.get(text) ?? []
      if (order[order.length - 1] !== signature) order.push(signature)
      history.set(text, order)
      const bySignature = phases.get(text) ?? new Map()
      const entry = bySignature.get(signature) ?? { afterDelta: 0, afterGap: 0, spans: line.spans }
      if (index % 2 === 0) entry.afterDelta++
      else entry.afterGap++
      bySignature.set(signature, entry)
      phases.set(text, bySignature)
    }
  })
  const worstText = [...history.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0]
  const hex = (color: RGBA) =>
    "#" + [color.r, color.g, color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")
  const worst =
    worstText === undefined
      ? []
      : [...(phases.get(worstText) ?? new Map()).values()]
          .sort((a, b) => b.afterDelta + b.afterGap - (a.afterDelta + a.afterGap))
          .slice(0, 3)
          .map(
            (entry) =>
              `afterDelta=${entry.afterDelta} afterGap=${entry.afterGap} :: ` +
              entry.spans.map((span: Line["spans"][number]) => `[${JSON.stringify(span.text)} ${hex(span.fg)} a${span.attributes}]`).join(""),
          )
  let oneWay = 0
  let returning = 0
  let returns = 0
  const examples: string[] = []
  for (const [text, order] of history) {
    if (order.length < 2) continue
    const back = order.filter((signature, i) => order.indexOf(signature) < i).length
    if (back === 0 && order.length === 2) oneWay++
    if (back > 0) {
      returning++
      returns += back
      if (examples.length < 4) examples.push(`${order.length} changes / ${back} back: ${JSON.stringify(text.slice(0, 60))}`)
    }
  }
  return { lines: history.size, oneWay, returning, returns, examples, worst }
}

async function replay(style: SyntaxStyle) {
  const md = new MarkdownRenderable(renderer, {
    treeSitterClient,
    syntaxStyle: style,
    streaming: true,
    internalBlockMode: "coalesced",
  })
  renderer.root.add(md)
  const frames: CapturedFrame[] = []
  const before = completions
  let content = ""
  for (const delta of deltas) {
    content += delta
    md.content = content
    await renderOnce()
    frames.push(captureSpans())
    await new Promise((resolve) => setTimeout(resolve, DELTA_GAP_MS))
    await renderOnce()
    frames.push(captureSpans())
  }
  const delivered = completions - before
  md.destroy()
  return { frames, delivered, stats: classify(frames) }
}

test("positive control: a style swap under fixed text is seen as returns", async () => {
  const md = new MarkdownRenderable(renderer, {
    treeSitterClient,
    syntaxStyle: richStyle,
    streaming: false,
    content: "# Title\n\nSome **bold** and *italic* with `code` and a [link](http://x.y).\n\n- item one\n- item two\n",
  })
  renderer.root.add(md)
  const frames: CapturedFrame[] = []
  for (const style of [richStyle, flatStyle, richStyle, flatStyle, richStyle]) {
    md.syntaxStyle = style
    for (let i = 0; i < 3; i++) {
      await renderOnce()
      await new Promise((resolve) => setTimeout(resolve, DELTA_GAP_MS))
    }
    frames.push(captureSpans())
  }
  md.destroy()
  const stats = classify(frames)
  console.log(`sources: positive-control ${JSON.stringify(stats)}`)
  expect(stats.returning).toBeGreaterThan(0)
})

test("the real stream at the live cadence: returns under a rich stylesheet vs a flat one", async () => {
  const flat = await replay(flatStyle)
  const rich = await replay(richStyle)
  console.log(`sources: deltas=${deltas.length} frames=${rich.frames.length}`)
  console.log(`sources: flat  delivered=${flat.delivered} ${JSON.stringify(flat.stats)}`)
  console.log(`sources: rich  delivered=${rich.delivered} ${JSON.stringify(rich.stats)}`)

  // Health: the second source really landed during the stream, so a zero cannot mean "never arrived".
  expect(rich.delivered).toBeGreaterThan(0)
  // Health: the frames carry text (an unmounted or unsized renderable paints nothing).
  expect(rich.stats.lines).toBeGreaterThan(20)
  // Negative control: with one style for everything, a return is impossible — a non-zero here would mean
  // the classifier is reading text reflow, not colour.
  expect(flat.stats.returning).toBe(0)
})
