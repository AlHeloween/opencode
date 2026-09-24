// Render LOAD baseline for plans/2026-09-22_reasoning-stream-render-stability.md T11b (owner, 2026-09-23:
// «кэш нужен чтобы снять нагрузку»). A measuring instrument, not source: it replays the real 843-delta
// stream through the REAL MarkdownRenderable and reports main-thread time per delta, split by scenario.
//
//   bun --cpu-prof-md --cpu-prof-dir=<dir> <this file> stream        # A: one message, production config
//   bun --cpu-prof-md --cpu-prof-dir=<dir> <this file> history <N>   # B: N finished messages + one stream
//
// Run with cwd = packages/opentui/packages/core (the native lib resolves from there).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdir } from "node:fs/promises"
import { MarkdownRenderable } from "../../packages/opentui/packages/core/src/renderables/Markdown.ts"
import { ScrollBoxRenderable } from "../../packages/opentui/packages/core/src/renderables/ScrollBox.ts"
import { SyntaxStyle } from "../../packages/opentui/packages/core/src/syntax-style.ts"
import { RGBA } from "../../packages/opentui/packages/core/src/lib/RGBA.ts"
import { TreeSitterClient } from "../../packages/opentui/packages/core/src/lib/tree-sitter/index.ts"
import { createTestRenderer } from "../../packages/opentui/packages/core/src/testing/test-renderer.ts"

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../packages/opentui/packages/core/src/renderables/__tests__/fixtures/reasoning-stream.json"),
    "utf8",
  ),
) as { deltas: string[] }
const deltas = fixture.deltas
const finalText = deltas.join("")

const c = (r: number, g: number, b: number) => RGBA.fromValues(r, g, b, 1)
const style = SyntaxStyle.fromStyles({
  default: { fg: c(0.85, 0.85, 0.85) },
  "markup.heading": { fg: c(1, 0.6, 0.2), bold: true },
  "markup.strong": { fg: c(1, 1, 1), bold: true },
  "markup.bold": { fg: c(1, 1, 1), bold: true },
  "markup.italic": { fg: c(0.8, 0.8, 1), italic: true },
  "markup.list": { fg: c(0.4, 0.8, 1) },
  "markup.raw": { fg: c(0.5, 1, 0.5) },
  "markup.raw.inline": { fg: c(0.3, 0.9, 0.3) },
  "markup.link": { fg: c(0.3, 0.6, 1), underline: true },
})

const mode = process.argv[2] ?? "stream"
const historyCount = mode === "history" ? Number(process.argv[3] ?? 0) : 0
// `stream <P>`: the same deltas appended to P chars already written — a LONG message still streaming.
const prefixChars = mode === "stream" ? Number(process.argv[3] ?? 0) : 0
const prefix = prefixChars > 0 ? (finalText + "\n\n").repeat(Math.ceil(prefixChars / (finalText.length + 2))).slice(0, prefixChars) + "\n\n" : ""
const GAP_MS = 25

const dataPath = join(tmpdir(), "tree-sitter-markdown-renderable-test-data")
await mkdir(dataPath, { recursive: true })
const treeSitterClient = new TreeSitterClient({ dataPath })
await treeSitterClient.initialize()

const setup = await createTestRenderer({ width: 100, height: 40 })
const renderer = setup.renderer

const scroll = new ScrollBoxRenderable(renderer, {
  width: "100%",
  height: "100%",
  stickyScroll: true,
  stickyStart: "bottom",
  viewportCulling: true,
})
renderer.root.add(scroll)

if (mode === "history") {
  for (let i = 0; i < historyCount; i++) {
    scroll.add(
      new MarkdownRenderable(renderer, {
        treeSitterClient,
        syntaxStyle: style,
        streaming: false,
        internalBlockMode: "coalesced",
        content: finalText,
      }),
    )
  }
  // Let the finished messages settle (their first parse) before the stream is measured.
  for (let i = 0; i < 20; i++) {
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, GAP_MS))
  }
}

const live = new MarkdownRenderable(renderer, {
  treeSitterClient,
  syntaxStyle: style,
  streaming: true,
  internalBlockMode: "coalesced",
})
scroll.add(live)

const perDelta: number[] = []
const setContent: number[] = []
let content = prefix
if (prefix) {
  live.content = prefix
  for (let i = 0; i < 10; i++) {
    await setup.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, GAP_MS))
  }
}
const started = performance.now()
for (const delta of deltas) {
  content += delta
  const t0 = performance.now()
  live.content = content
  const t1 = performance.now()
  await setup.renderOnce()
  const t2 = performance.now()
  setContent.push(t1 - t0)
  perDelta.push(t2 - t0)
  await new Promise((resolve) => setTimeout(resolve, GAP_MS))
  // The frame in which a parse result lands is main-thread work too.
  const t3 = performance.now()
  await setup.renderOnce()
  perDelta[perDelta.length - 1] += performance.now() - t3
}
const wall = performance.now() - started

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!
const quarter = Math.floor(perDelta.length / 4)
console.log(
  JSON.stringify({
    mode,
    historyCount,
    prefixChars: prefix.length,
    deltas: deltas.length,
    finalChars: finalText.length,
    wallMs: Math.round(wall),
    mainMsTotal: Math.round(sum(perDelta)),
    mainMsPerDelta: Number((sum(perDelta) / perDelta.length).toFixed(3)),
    p50: Number(pct(perDelta, 0.5).toFixed(3)),
    p95: Number(pct(perDelta, 0.95).toFixed(3)),
    setContentMsPerDelta: Number((sum(setContent) / setContent.length).toFixed(3)),
    // Growth: the first quarter of the stream against the last — O(n) per delta shows as a rising ratio.
    firstQuarterMs: Number((sum(perDelta.slice(0, quarter)) / quarter).toFixed(3)),
    lastQuarterMs: Number((sum(perDelta.slice(-quarter)) / quarter).toFixed(3)),
  }),
)

renderer.destroy()
await treeSitterClient.destroy()
process.exit(0)
