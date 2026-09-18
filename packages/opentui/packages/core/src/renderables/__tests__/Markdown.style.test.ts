import { test, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { StyledText } from "../../lib/styled-text.js"
import { TreeSitterClient } from "../../lib/tree-sitter/index.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { CodeRenderable } from "../Code.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"
import { TextAttributes, type CapturedFrame } from "../../types.js"

/**
 * Style-level oracle for the markdown renderer.
 *
 * Every other markdown test asserts CHARACTERS — which glyphs land in which
 * columns. That is why swapping the source of the styling passed green while
 * destroying every colour the application had applied (2026-09-18): the text
 * was byte-identical, only the bold, the syntax colour and the muted reasoning
 * tint were gone, and nothing looked at those.
 *
 * These tests assert what the user actually sees: attributes and colour on the
 * rendered spans. They must fail whenever styling is lost, even when the text
 * is perfect.
 */

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureSpans: () => CapturedFrame
let treeSitterClient: TreeSitterClient

const BODY = RGBA.fromValues(1, 1, 1, 1)

const KEYWORD = RGBA.fromValues(1, 0.3, 0.6, 1)
const FUNCTION = RGBA.fromValues(0.3, 0.7, 1, 1)

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: BODY },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  // A grammar that never resolves leaves every token on `default`, so the
  // colour assertions below need real per-group colours to be able to fail.
  keyword: { fg: KEYWORD },
  "keyword.function": { fg: KEYWORD },
  function: { fg: FUNCTION },
})

beforeAll(async () => {
  const dataPath = join(tmpdir(), "tree-sitter-markdown-style-test-data")
  await mkdir(dataPath, { recursive: true })
  treeSitterClient = new TreeSitterClient({ dataPath })
  await treeSitterClient.initialize()
})

afterAll(async () => {
  await treeSitterClient.destroy()
})

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 20 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureSpans = testRenderer.captureSpans
})

afterEach(() => {
  if (renderer) renderer.destroy()
})

function createMarkdown(options: MarkdownOptions): MarkdownRenderable {
  return new MarkdownRenderable(renderer, { treeSitterClient, ...options })
}

function spanContaining(text: string) {
  for (const line of captureSpans().lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text))
    if (span) return span
  }
  return undefined
}

/** Every character rendered anywhere in the frame, spans joined. */
function renderedText(): string {
  return captureSpans()
    .lines.map((line) => line.spans.map((span) => span.text).join(""))
    .join("\n")
}

async function render(content: string, options: Partial<MarkdownOptions> = {}): Promise<void> {
  const markdown = createMarkdown({ content, syntaxStyle, ...options })
  renderer.root.add(markdown)
  await renderer.idle()
  // Highlighting is async per block; capturing before it lands would assert the
  // unstyled first frame and pass for the wrong reason.
  for (const state of markdown._blockStates) {
    const block = state?.renderable as CodeRenderable | undefined
    if (block?.highlightingDone) await block.highlightingDone
  }
  await renderer.idle()
}

test("bold text carries the BOLD attribute, not just the right characters", async () => {
  await render("This is **Это** bold.")

  const span = spanContaining("Это")
  expect(span).toBeDefined()
  expect(span!.attributes & TextAttributes.BOLD).toBeTruthy()
})

test("bold markers are concealed", async () => {
  await render("This is **Это** bold.")

  expect(renderedText()).not.toContain("**")
})

test("italic text carries the ITALIC attribute", async () => {
  await render("This is *slanted* text.")

  const span = spanContaining("slanted")
  expect(span).toBeDefined()
  expect(span!.attributes & TextAttributes.ITALIC).toBeTruthy()
})

test("plain body text carries neither attribute", async () => {
  // Guards the opposite failure: a renderer that bolds everything would pass
  // the assertions above while being just as wrong.
  await render("This is **Это** bold.")

  const span = spanContaining("bold.")
  expect(span).toBeDefined()
  expect(span!.attributes & TextAttributes.BOLD).toBeFalsy()
  expect(span!.attributes & TextAttributes.ITALIC).toBeFalsy()
})

// Only javascript, typescript, markdown, markdown_inline and zig ship as
// bundled grammars in this package. A block in any other language has no parser
// and correctly falls back to body colour, so asserting against one would test
// the asset list, not the renderer.

test("a fenced block is coloured by ITS OWN grammar, not by markdown", async () => {
  // The acceptance condition Alexander named: different file types must be
  // highlighted by different grammars. A markdown-only colouring would leave
  // the keyword the same colour as the surrounding prose.
  await render(["Before.", "", "```typescript", "function greet() {}", "```", "", "After."].join("\n"))

  const keyword = spanContaining("function")
  const prose = spanContaining("Before.")
  expect(keyword).toBeDefined()
  expect(prose).toBeDefined()
  expect(keyword!.fg.toInts()).not.toEqual(prose!.fg.toInts())
})

// ── The application's own styling ────────────────────────────────────────────
//
// opencode does not hand the renderer raw markdown: it hands it text that is
// ALREADY styled — muted reasoning, agent tints, its own link colours — through
// `initialStyledText`. Nothing tested that path, which is why removing its
// protection passed every suite while stripping every colour the application
// applied (2026-09-18: "reasoning обычно темный, сейчас идет как обычный
// шрифт"). Highlighting must not be able to erase it.

const REASONING_DIM = RGBA.fromValues(0.45, 0.45, 0.45, 1)

function styledParagraph(text: string, fg: RGBA): StyledText {
  return new StyledText([{ __isChunk: true, text, fg }])
}

async function renderCode(options: { content: string; filetype: string; initialStyledText?: StyledText }) {
  const code = new CodeRenderable(renderer, {
    content: options.content,
    filetype: options.filetype,
    syntaxStyle,
    treeSitterClient,
    initialStyledText: options.initialStyledText,
  })
  renderer.root.add(code)
  await renderer.idle()
  await code.highlightingDone
  await renderer.idle()
  return code
}

test("application styling survives markdown highlighting", async () => {
  const text = "Considering the transport ladder before answering."
  await renderCode({
    content: text,
    filetype: "markdown",
    initialStyledText: styledParagraph(text, REASONING_DIM),
  })

  const span = spanContaining("transport ladder")
  expect(span).toBeDefined()
  expect(span!.fg.toInts()).toEqual(REASONING_DIM.toInts())
})

test("application styling is not silently replaced by body colour", async () => {
  // Stated as the failure rather than the success, because the regression made
  // the text render in the default colour — correct characters, wrong paint.
  const text = "Considering the transport ladder before answering."
  await renderCode({
    content: text,
    filetype: "markdown",
    initialStyledText: styledParagraph(text, REASONING_DIM),
  })

  const span = spanContaining("transport ladder")
  expect(span!.fg.toInts()).not.toEqual(BODY.toInts())
})

test("application EMPHASIS survives highlighting, not just colour", async () => {
  // The same defect one field over: the first merge carried the application's
  // colour and dropped its attributes, so markdown's own bold and italic
  // vanished while the syntax colouring looked perfect (Alexander, 2026-09-18:
  // "триситтер отображается верно - markdown форматирование исчезло").
  const text = "Considering the transport ladder before answering."
  await renderCode({
    content: text,
    filetype: "markdown",
    initialStyledText: new StyledText([
      { __isChunk: true, text: "Considering the ", fg: REASONING_DIM },
      { __isChunk: true, text: "transport ladder", fg: REASONING_DIM, attributes: TextAttributes.BOLD },
      { __isChunk: true, text: " before answering.", fg: REASONING_DIM },
    ]),
  })

  const emphasised = spanContaining("transport ladder")
  expect(emphasised).toBeDefined()
  expect(emphasised!.attributes & TextAttributes.BOLD).toBeTruthy()
  expect(emphasised!.fg.toInts()).toEqual(REASONING_DIM.toInts())
})

// ── The renderable's OWN colour ──────────────────────────────────────────────
//
// The gap that let the 2026-09-18 regression through TWICE: every test above
// hands the renderer a hand-built `initialStyledText`, so `createChunk` — the
// place the renderer builds its own chunks, and the place the `fg` prop was
// being replaced by the syntax `default` scope — had no coverage at all. With
// no tree-sitter the text buffer paints the `fg` prop, which is why muted
// reasoning looked right before highlighting existed and light once it landed
// (Alexander, 2026-09-18: "цвет thinking должен быть как у комментов", and
// `syntaxComment` IS `textMuted` — theme.tsx:618).
test("the renderable's fg prop reaches its own chunks, not the syntax default", async () => {
  await render("Considering the transport ladder.", { fg: REASONING_DIM })

  const span = spanContaining("transport ladder")
  expect(span).toBeDefined()
  expect(span!.fg.toInts()).toEqual(REASONING_DIM.toInts())
  expect(span!.fg.toInts()).not.toEqual(BODY.toInts())
})

test("a long token in the LAST fenced block is emitted once, not duplicated at the end", async () => {
  // Alexander, 2026-09-18: the SV block is the last block of every reply, and a
  // fragment of its 32-zero `parent-goal-md5` line shows up AGAIN on its own
  // line at the very end — "эта ошибка вылезает только в конце". A wrap would hit
  // any line, so only the end-of-content path can do this: the trailing
  // `content.slice(currentOffset)` push (tree-sitter-styled-text.ts:320). Count
  // the characters rather than trusting the shape.
  const zeros = "0".repeat(32)
  await render(["Text before.", "", "```yaml", `parent-goal-md5: ${zeros}`, "```"].join("\n"))

  const zeroCount = [...renderedText()].filter((character) => character === "0").length
  expect(zeroCount).toBe(32)
})

test("a source file with no application styling is fully driven by its grammar", async () => {
  // The other side of the same rule, and Alexander's editing constraint: where
  // the application supplies nothing, tree-sitter must own the colour outright.
  await renderCode({ content: "function greet() {}", filetype: "typescript" })

  const span = spanContaining("function")
  expect(span).toBeDefined()
  expect(span!.fg.toInts()).not.toEqual(BODY.toInts())
})

test("an unbundled language falls back to body colour instead of guessing", async () => {
  // The other half of the contract: no parser must mean no colouring, never a
  // wrong grammar applied because it happened to be loaded.
  await render(["```python", "def greet():", "    pass", "```"].join("\n"))

  const span = spanContaining("def")
  expect(span).toBeDefined()
  expect(span!.fg.toInts()).toEqual(BODY.toInts())
})
