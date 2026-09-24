/**
 * T11b step 2 of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md — the VISUAL-EQUIVALENCE oracle.
 *
 * Step 2 cuts the coalesced prose run into closed (never-changing) runs plus a live tail, so a finished
 * paragraph stops being re-styled on every delta. That is only a cache if the picture does not change:
 * the settled frame of a streamed message must be byte-identical to what the unsplit renderer drew.
 * The snapshots below were WRITTEN BY THE PRE-CHANGE CODE and are the reference; the streamed and the
 * one-shot render must also equal each other. Text AND spans are compared, so a lost blank line, a moved
 * wrap or a colour that differs at a cut all fail here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test"
import { MarkdownRenderable } from "../Markdown.js"
import { CodeRenderable } from "../Code.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { TreeSitterClient } from "../../lib/tree-sitter/index.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"
import type { Renderable } from "../../Renderable.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
import type { CapturedFrame } from "../../types.js"

setDefaultTimeout(120_000)

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "reasoning-stream.json"), "utf8")) as {
  deltas: string[]
}

const c = (r: number, g: number, b: number) => RGBA.fromValues(r, g, b, 1)
const style = SyntaxStyle.fromStyles({
  default: { fg: c(0.85, 0.85, 0.85) },
  "markup.heading": { fg: c(1, 0.6, 0.2), bold: true },
  "markup.heading.1": { fg: c(1, 0.5, 0.1), bold: true },
  "markup.heading.2": { fg: c(1, 0.55, 0.15), bold: true },
  "markup.strong": { fg: c(1, 1, 1), bold: true },
  "markup.bold": { fg: c(1, 1, 1), bold: true },
  "markup.italic": { fg: c(0.8, 0.8, 1), italic: true },
  "markup.list": { fg: c(0.4, 0.8, 1) },
  "markup.raw": { fg: c(0.5, 1, 0.5) },
  "markup.raw.inline": { fg: c(0.3, 0.9, 0.3) },
  "markup.link": { fg: c(0.3, 0.6, 1), underline: true },
  keyword: { fg: c(0.8, 0.4, 1) },
  string: { fg: c(0.9, 0.8, 0.3) },
})

/** A long document of the shapes a model writes: headings, paragraphs with inline marks, lists, a fence. */
function syntheticDocument(targetChars: number): string {
  const sections: string[] = []
  for (let i = 0; sections.join("").length < targetChars; i++) {
    sections.push(
      `## Section ${i}\n\n` +
        `Paragraph ${i} carries **bold ${i}**, *italic ${i}* and \`code ${i}\` so every inline mark is present, ` +
        `and it runs long enough to wrap across the viewport width more than once when it is drawn.\n\n` +
        `A second paragraph in section ${i}, plain, followed by a list.\n\n` +
        `- item ${i}.a with \`inline\`\n- item ${i}.b with **strong**\n\n` +
        (i % 3 === 0 ? "```ts\nconst value" + i + " = " + i + "\n```\n\n" : ""),
    )
  }
  return sections.join("")
}

const TEXTS: Array<{ name: string; text: string; step: number }> = [
  { name: "real stream fixture", text: fixture.deltas.join(""), step: 0 },
  { name: "synthetic 12k document", text: syntheticDocument(12_000), step: 9 },
]

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureCharFrame: () => string
let captureSpans: () => CapturedFrame
let treeSitterClient: TreeSitterClient

beforeAll(async () => {
  const dataPath = join(tmpdir(), "tree-sitter-markdown-renderable-test-data")
  await mkdir(dataPath, { recursive: true })
  treeSitterClient = new TreeSitterClient({ dataPath })
  await treeSitterClient.initialize()
})

afterAll(async () => {
  await treeSitterClient.destroy()
})

beforeEach(async () => {
  const setup = await createTestRenderer({ width: 100, height: 400 })
  renderer = setup.renderer
  renderOnce = setup.renderOnce
  captureCharFrame = setup.captureCharFrame
  captureSpans = setup.captureSpans
})

afterEach(() => {
  renderer.destroy()
})

function codeRenderables(node: Renderable, found: CodeRenderable[] = []): CodeRenderable[] {
  if (node instanceof CodeRenderable) found.push(node)
  for (const child of node.getChildren()) codeRenderables(child as Renderable, found)
  return found
}

/** Settled = no Code renderable highlighting for three consecutive passes. */
async function settle(md: MarkdownRenderable): Promise<void> {
  let quiet = 0
  for (let i = 0; i < 200 && quiet < 3; i++) {
    await renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 15))
    quiet = codeRenderables(md).some((code) => code.isHighlighting) ? 0 : quiet + 1
  }
  await renderOnce()
}

function frameOf(): { text: string; spans: string } {
  const spans = captureSpans()
  return {
    text: captureCharFrame().trimEnd(),
    spans: JSON.stringify(
      spans.lines.map((line) => line.spans.map((span) => [span.text, [span.fg.r, span.fg.g, span.fg.b], span.attributes])),
    ),
  }
}

async function streamed(text: string, deltas: string[] | undefined, step: number) {
  const md = new MarkdownRenderable(renderer, { treeSitterClient, syntaxStyle: style, streaming: true })
  renderer.root.add(md)
  const pieces = deltas ?? Array.from({ length: Math.ceil(text.length / step) }, (_, i) => text.slice(i * step, (i + 1) * step))
  let content = ""
  for (const piece of pieces) {
    content += piece
    md.content = content
    await renderOnce()
  }
  await settle(md)
  const frame = frameOf()
  const blocks = md.getChildren().length
  md.destroy()
  return { frame, blocks }
}

async function oneShot(text: string) {
  const md = new MarkdownRenderable(renderer, { treeSitterClient, syntaxStyle: style, streaming: true, content: text })
  renderer.root.add(md)
  await settle(md)
  const frame = frameOf()
  md.destroy()
  return { frame }
}

// A FINISHED message (streaming: false — every token stable) is cut only by the size cap; its reference is
// likewise a snapshot written by the pre-change code. Long enough to cross the cap several times.
test("a finished message renders identically when its run is closed at the cap", async () => {
  const text = (fixture.deltas.join("") + "\n\n").repeat(3)
  const md = new MarkdownRenderable(renderer, { treeSitterClient, syntaxStyle: style, streaming: false, content: text })
  renderer.root.add(md)
  await settle(md)
  const frame = frameOf()
  console.log(`closed-runs: finished chars=${text.length} blocks=${md.getChildren().length}`)
  md.destroy()
  expect(frame.text.length).toBeGreaterThan(500)
  expect(frame.text).toMatchSnapshot()
  expect(frame.spans).toMatchSnapshot()
})

for (const sample of TEXTS) {
  test(`${sample.name}: the settled streamed frame equals the reference and the one-shot render`, async () => {
    const live = await streamed(sample.text, sample.step === 0 ? fixture.deltas : undefined, sample.step)
    const reference = await oneShot(sample.text)
    console.log(`closed-runs: ${sample.name} chars=${sample.text.length} blocks=${live.blocks}`)
    // The frames carry the text (an empty frame would make every comparison below vacuous).
    expect(live.frame.text.length).toBeGreaterThan(500)
    expect(live.frame.text).toBe(reference.frame.text)
    expect(live.frame.spans).toBe(reference.frame.spans)
    expect(live.frame.text).toMatchSnapshot()
    expect(live.frame.spans).toMatchSnapshot()
  })
}
