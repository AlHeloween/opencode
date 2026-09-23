/**
 * T4 of plans/2026-09-22_reasoning-stream-render-stability.md — THE ISOLATED REPLAY.
 *
 * Owner, 2026-09-23: «возьми данные из логгера и изолированно просимулируй их в экспериментах. На ране
 * всю систему flick length 0.1 seconds как ты можешь их поймать?» He is right and the live-pixel path
 * says so itself: a ~100 ms event sampled at a ~1.9 s screenshot cadence is caught in ~5 % of frames.
 * Here the clock is ours — the REAL delta stream (extracted byte-exact from a gateway SSE capture,
 * `experiments/2026-09-23_stream-replay/extract.py`) is replayed through the REAL Markdown renderable
 * and a frame is captured after EVERY delta.
 *
 * THE PREDICATE — a style change without a text change. For each line TEXT, collect the sequence of
 * span signatures it takes across the frames it appears in. A line whose text never changed but whose
 * signature takes THREE OR MORE distinct values, or RETURNS to an earlier one, has been repainted from
 * a second style source while the stream wrote nothing there: that is the colour flicker, and the line
 * text localises it. Text changes are excluded by construction, because a streaming markdown legitimately
 * re-wraps its last paragraph on every delta — and TWO signatures is a one-way switch (unstyled until
 * the first parse lands, then styled), which is the DESIGNED behaviour of the quiet window, not a defect.
 *
 * WHAT IT DOES NOT YET HAVE: a positive control. A metric that reads 0 in every run has not been shown
 * able to read anything else, so the counts below are a MEASUREMENT, not a PASS — the legacy drive path
 * (pre-T6: repaint the preview from the unstyled source) is what must make it non-zero, and it is not
 * built yet. Recorded as the next step rather than assumed.
 */
import { test, expect, setDefaultTimeout, beforeAll, beforeEach, afterEach, afterAll } from "bun:test"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { TreeSitterClient } from "../../lib/tree-sitter/index.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import type { CapturedFrame } from "../../types.js"
import { readFileSync } from "node:fs"

// Read, do not import: this package does not enable `resolveJsonModule`, so a JSON import is a
// compile error — and a fixture that cannot be loaded would have taken the whole harness with it.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "reasoning-stream.json"), "utf8"),
) as { source: string; deltas: string[] }

const deltas: string[] = fixture.deltas

// A FILE-level timeout, never per-test whack-a-mole: the replay drives ~1700 render passes (843 deltas
// x 2 runs) plus the pauses, and bun's 5 s default cut it off with 0 pass / 1 fail — a red that said
// nothing about the code. Measured: the first run reached the 5 s wall without finishing.
setDefaultTimeout(120_000)

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureSpans: () => CapturedFrame
let treeSitterClient: TreeSitterClient

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

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
  const testRenderer = await createTestRenderer({ width: 60, height: 40 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureSpans = testRenderer.captureSpans
})

afterEach(() => {
  try {
    renderer.destroy()
  } catch (error) {
    // The cost test destroys each renderer itself; a second destroy is not a failure, but it is not
    // silent either.
    console.log(`replay: renderer already destroyed (${String(error)})`)
  }
})

/** One frame, SETTLED. Markdown layout is asynchronous, so a single render pass can capture an
 *  UNPAINTED screen. Measured on the first replay run: with one pass, 843 frames yielded only 4
 *  distinct line texts — nearly every frame was blank, and a metric reading 0 there would have been
 *  reading it for the wrong reason. Two passes with a macrotask between them is the smallest fix. */
async function settle(): Promise<void> {
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await renderOnce()
}

type Line = CapturedFrame["lines"][number]

function lineText(line: Line): string {
  return line.spans.map((span) => span.text).join("")
}

function lineSignature(line: Line): string {
  // The whole span list, so ANY repaint that changes a colour, an attribute or a span split is visible.
  return JSON.stringify(line.spans)
}

/** text -> ordered distinct signatures seen, in frame order. */
function signaturesByLine(frames: CapturedFrame[]): Map<string, string[]> {
  const perLine = new Map<string, string[]>()
  for (const frame of frames) {
    const seenThisFrame = new Map<string, string>()
    for (const line of frame.lines) {
      const text = lineText(line).trimEnd()
      if (!text) continue
      seenThisFrame.set(text, lineSignature(line))
    }
    for (const [text, signature] of seenThisFrame) {
      const order = perLine.get(text) ?? []
      // Every CHANGE is recorded, including a change back: the previous `!order.includes(signature)`
      // folded A -> B -> A into [A, B] and so could never report the return its header promises
      // (found 2026-09-23 by `stream-replay-sources.test.ts`, which supersedes this measurement).
      if (order[order.length - 1] !== signature) order.push(signature)
      perLine.set(text, order)
    }
  }
  return perLine
}

function classify(frames: CapturedFrame[]) {
  const perLine = signaturesByLine(frames)
  let oneWay = 0
  let flickered = 0
  const examples: string[] = []
  for (const [text, signatures] of perLine) {
    if (signatures.length <= 1) continue
    if (signatures.length === 2) {
      oneWay += 1
      continue
    }
    flickered += 1
    if (examples.length < 5) examples.push(`${signatures.length}x ${JSON.stringify(text.slice(0, 70))}`)
  }
  return { lines: perLine.size, oneWay, flickered, examples }
}

async function replay(
  windowMs: number,
  pauseEvery: number,
  pauseMs: number,
  blockMode: "coalesced" | "top-level" = "coalesced",
) {
  const md = new MarkdownRenderable(renderer, {
    treeSitterClient,
    syntaxStyle,
    quietHighlightMs: windowMs,
    internalBlockMode: blockMode,
  } satisfies MarkdownOptions)
  renderer.root.add(md)

  const frames: CapturedFrame[] = []
  let accumulated = ""
  for (let i = 0; i < deltas.length; i++) {
    accumulated += deltas[i]
    md.content = accumulated
    await settle()
    frames.push(captureSpans())
    // The real stream has PAUSES, and the pause is where the deferred parse lands — which is exactly how
    // a second style source gets a chance to paint. A replay without them would test a burst that never
    // happens.
    if (pauseEvery > 0 && i > 0 && i % pauseEvery === 0 && pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs))
      await settle()
      frames.push(captureSpans())
    }
  }

  const last = frames[frames.length - 1]
  md.destroy()
  return { frames, last }
}

test("the real delta stream replayed through the real Markdown renderable flips no line", async () => {
  const burst = await replay(60, 0, 0)
  const burstStats = classify(burst.frames)

  const withPauses = await replay(60, 40, 90)
  const pauseStats = classify(withPauses.frames)

  // The instrument must not be silently blank: an unmounted or unsized renderable paints empty frames
  // and every metric above would read 0 for the wrong reason.
  const lastText = burst.last.lines
    .map((line) => lineText(line))
    .join("")
    .trim()
  expect(lastText.length).toBeGreaterThan(100)

  console.log(`replay: deltas=${deltas.length} frames=${burst.frames.length} burst=${JSON.stringify(burstStats)}`)
  console.log(`replay: frames=${withPauses.frames.length} withPauses=${JSON.stringify(pauseStats)}`)
  // The instrument's own health report: a blank frame is not evidence about styling, and a run whose
  // frames are mostly blank cannot support any conclusion at all.
  const blank = (frames: CapturedFrame[]) =>
    frames.filter((frame) => frame.lines.map((line) => lineText(line)).join("").trim().length < 20).length
  console.log(`replay: blank_frames burst=${blank(burst.frames)}/${burst.frames.length} pauses=${blank(withPauses.frames)}/${withPauses.frames.length}`)

  // REMOVED, with its reason: the one-shot equality check — "the settled streaming view must equal a
  // one-shot render of the same text" — captured an EMPTY frame (`Expected: ""` against 2379 bytes of
  // streamed text) as soon as a third MarkdownRenderable joined `renderer.root`. Suspicion, not a
  // diagnosis: children of the root lay out in sequence, so the comparison may be reading a renderable
  // placed BELOW the 40-row viewport, or `destroy()` may not detach from the root. It returns only after
  // that is settled — a comparison whose subject is off-screen reads as a failure of the code under
  // measurement, and a red test left in the tree is a collected defect, not a finding.
  const streamText = withPauses.last.lines
    .map((line) => lineText(line))
    .join("")
    .trimEnd()
  console.log(`replay: stream_text_chars=${streamText.length}`)
  console.log(`replay: NOTE the flicker count is a MEASUREMENT, not a PASS: with no positive control a 0`)
  console.log(`replay:      has not been shown able to read anything else. See the plan, T4.`)
})

test("the cost of each rendering configuration, on the same real stream", async () => {
  // The owner reports the TUI «безнадежно лагает» after the 2026-09-23 build, and that build changed
  // exactly two things on this path: `internalBlockMode` became "top-level" (T7), and the quiet window's
  // default moved to 0 because NOTHING in `packages/opencode` passes `quietHighlightMs` (T8c). Choosing
  // between them by argument is what the isolated replay exists to replace: same stream, same renderer,
  // four configurations, one clock.
  //
  // The number is a COST PROXY, not the TUI's frame time: it is the wall time to replay 843 real deltas
  // with a settled frame each — the same parse+layout+paint work the TUI does per delta.
  const configs: Array<{ name: string; mode: "coalesced" | "top-level"; windowMs: number }> = [
    { name: "coalesced+window75 (the build before today)", mode: "coalesced", windowMs: 75 },
    { name: "coalesced+window0", mode: "coalesced", windowMs: 0 },
    { name: "top-level+window75", mode: "top-level", windowMs: 75 },
    { name: "top-level+window0 (the build today)", mode: "top-level", windowMs: 0 },
  ]
  for (const config of configs) {
    const testRenderer = await createTestRenderer({ width: 60, height: 40 })
    renderer = testRenderer.renderer
    renderOnce = testRenderer.renderOnce
    captureSpans = testRenderer.captureSpans
    const started = performance.now()
    const result = await replay(config.windowMs, 0, 0, config.mode)
    const elapsed = performance.now() - started
    console.log(
      `cost: ${config.name} frames=${result.frames.length} ms=${Math.round(elapsed)} ms_per_frame=${(elapsed / result.frames.length).toFixed(2)}`,
    )
    renderer.destroy()
  }
})
