/**
 * T11b step 4 of plans/2026-09-22_reasoning-stream-render-stability.md — `deferred` postpones the build.
 *
 * Entering a session constructs (lexes) every loaded message at once — 154 ms for 40 × 12 000 chars on the
 * first mount, ~85 % of it marked's block lex. The owner chose to build bottom-up: the newest messages at
 * once, the history above in slices. The core half is one flag: while `deferred` is set a MarkdownRenderable
 * stores its content and builds NOTHING; clearing it builds once — and the picture must then equal an eager
 * render of the same text (text AND spans), or deferral is a visual change, not an optimisation.
 */
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test"
import { MarkdownRenderable } from "../Markdown.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"
import type { CapturedFrame } from "../../types.js"

setDefaultTimeout(30_000)

const style = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(0.85, 0.85, 0.85, 1) },
  "markup.strong": { fg: RGBA.fromValues(1, 1, 1, 1), bold: true },
})
const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with **bold** text.\n\n- item ${i}`).join("\n\n")

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureSpans: () => CapturedFrame

beforeEach(async () => {
  const setup = await createTestRenderer({ width: 80, height: 200 })
  renderer = setup.renderer
  renderOnce = setup.renderOnce
  captureSpans = setup.captureSpans
})

afterEach(() => {
  renderer.destroy()
})

const frame = () =>
  JSON.stringify(captureSpans().lines.map((line) => line.spans.map((span) => [span.text, [span.fg.r, span.fg.g, span.fg.b], span.attributes])))

test("a deferred markdown builds nothing until it is released, then renders like an eager one", async () => {
  const eager = new MarkdownRenderable(renderer, { syntaxStyle: style, content: text })
  renderer.root.add(eager)
  await renderOnce()
  await renderOnce()
  const eagerFrame = frame()
  const eagerBlocks = eager.getChildren().length
  eager.destroy()
  await renderOnce()

  const md = new MarkdownRenderable(renderer, { syntaxStyle: style, content: text, deferred: true })
  renderer.root.add(md)
  await renderOnce()
  // Nothing built: no blocks, no parse state — the content is only stored.
  expect(md.getChildren().length).toBe(0)
  expect(md._parseState).toBeNull()
  expect(md.content).toBe(text)
  // A content change while deferred is stored, still not built.
  md.content = text + "\n\nTail."
  md.content = text
  expect(md.getChildren().length).toBe(0)

  md.deferred = false
  await renderOnce()
  await renderOnce()
  // Control: the eager render really built blocks, so "equal frames" is not two empty screens.
  expect(eagerBlocks).toBeGreaterThan(0)
  expect(md.getChildren().length).toBe(eagerBlocks)
  expect(frame()).toBe(eagerFrame)
})
