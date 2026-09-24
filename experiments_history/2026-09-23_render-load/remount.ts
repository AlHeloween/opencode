// T11b step 3 of plans/2026-09-22_reasoning-stream-render-stability.md — what does (re)mounting finished
// messages cost? Entering a session mounts every loaded message at once; leaving and re-entering does it
// again from scratch. Measures main-thread time for construction (marked lex), the first frame, and the
// settle (tree-sitter results landing), plus the number of parses, for a first mount and a remount.
//
//   bun remount.ts <N messages> <chars per message>     (cwd = packages/opentui/packages/core)
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdir } from "node:fs/promises"
import { MarkdownRenderable } from "../../packages/opentui/packages/core/src/renderables/Markdown.ts"
import { CodeRenderable } from "../../packages/opentui/packages/core/src/renderables/Code.ts"
import { ScrollBoxRenderable } from "../../packages/opentui/packages/core/src/renderables/ScrollBox.ts"
import { SyntaxStyle } from "../../packages/opentui/packages/core/src/syntax-style.ts"
import { RGBA } from "../../packages/opentui/packages/core/src/lib/RGBA.ts"
import { TreeSitterClient } from "../../packages/opentui/packages/core/src/lib/tree-sitter/index.ts"
import { createTestRenderer } from "../../packages/opentui/packages/core/src/testing/test-renderer.ts"
import type { Renderable } from "../../packages/opentui/packages/core/src/Renderable.ts"

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../packages/opentui/packages/core/src/renderables/__tests__/fixtures/reasoning-stream.json"),
    "utf8",
  ),
) as { deltas: string[] }
const base = fixture.deltas.join("")
const count = Number(process.argv[2] ?? 40)
const chars = Number(process.argv[3] ?? base.length)
const messages = Array.from({ length: count }, (_, i) =>
  (`Message ${i}.\n\n` + (base + "\n\n").repeat(Math.ceil(chars / base.length))).slice(0, chars),
)

const c = (r: number, g: number, b: number) => RGBA.fromValues(r, g, b, 1)
const style = SyntaxStyle.fromStyles({
  default: { fg: c(0.85, 0.85, 0.85) },
  "markup.list": { fg: c(0.4, 0.8, 1) },
  "markup.strong": { fg: c(1, 1, 1), bold: true },
  "markup.raw.inline": { fg: c(0.3, 0.9, 0.3) },
})

const dataPath = join(tmpdir(), "tree-sitter-markdown-renderable-test-data")
await mkdir(dataPath, { recursive: true })
const treeSitterClient = new TreeSitterClient({ dataPath })
await treeSitterClient.initialize()
let parses = 0
const highlightOnce = treeSitterClient.highlightOnce.bind(treeSitterClient)
treeSitterClient.highlightOnce = async (...args: Parameters<typeof highlightOnce>) => {
  const result = await highlightOnce(...args)
  parses++
  return result
}

const setup = await createTestRenderer({ width: 100, height: 40 })
const scroll = new ScrollBoxRenderable(setup.renderer, {
  width: "100%",
  height: "100%",
  stickyScroll: true,
  stickyStart: "bottom",
  viewportCulling: true,
})
setup.renderer.root.add(scroll)

const codes = (node: Renderable, found: CodeRenderable[] = []) => {
  if (node instanceof CodeRenderable) found.push(node)
  for (const child of node.getChildren()) codes(child as Renderable, found)
  return found
}

async function mount() {
  const parsesBefore = parses
  const t0 = performance.now()
  const mounted = messages.map((content) => {
    const md = new MarkdownRenderable(setup.renderer, { treeSitterClient, syntaxStyle: style, streaming: false, content })
    scroll.add(md)
    return md
  })
  const t1 = performance.now()
  await setup.renderOnce()
  const t2 = performance.now()
  // Settle: main-thread time of the frames in which parse results land, until nothing is highlighting.
  let settleMain = 0
  let quiet = 0
  for (let i = 0; i < 400 && quiet < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const s = performance.now()
    await setup.renderOnce()
    settleMain += performance.now() - s
    quiet = mounted.some((md) => codes(md).some((code) => code.isHighlighting)) ? 0 : quiet + 1
  }
  return {
    mounted,
    constructMs: Number((t1 - t0).toFixed(1)),
    firstFrameMs: Number((t2 - t1).toFixed(1)),
    settleMainMs: Number(settleMain.toFixed(1)),
    parses: parses - parsesBefore,
    blocks: mounted.reduce((sum, md) => sum + md.getChildren().length, 0),
  }
}

const strip = ({ mounted, ...rest }: Awaited<ReturnType<typeof mount>>) => rest
if (process.argv[4] === "bottom-up") {
  // The route's policy, the REAL functions: eager newest until 20 000 chars (min 3), the rest released in
  // 24 000-char slices newest first. Measured: the synchronous entry cost, each slice, and the final frame
  // against an eager mount of the same messages (text AND spans).
  const { deferredOnEntry, nextSlice } = await import(
    "../../packages/opencode/src/cli/cmd/tui/routes/session/deferred-mount.ts"
  )
  // Bottom-up runs FIRST, on a cold lex cache: an eager mount before it would warm the step-3 cache and turn
  // this into a remount measurement. The eager mount comes after, only for its reference frame.
  const ids = messages.map((_, i) => `m${i}`)
  let pending = deferredOnEntry(ids.map((id, i) => ({ id, chars: messages[i]!.length })), 20_000, 3)
  const deferredSet = new Set(pending)
  const t0 = performance.now()
  const byId = new Map<string, MarkdownRenderable>()
  messages.forEach((content, i) => {
    const md = new MarkdownRenderable(setup.renderer, {
      treeSitterClient,
      syntaxStyle: style,
      streaming: false,
      content,
      deferred: deferredSet.has(ids[i]!),
    })
    scroll.add(md)
    byId.set(ids[i]!, md)
  })
  const t1 = performance.now()
  await setup.renderOnce()
  const t2 = performance.now()
  const slices: number[] = []
  const buildMs: number[] = []
  const frameMs: number[] = []
  while (pending.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 16))
    const slice = nextSlice(pending, (id) => messages[Number(id.slice(1))]!.length, 24_000)
    const s = performance.now()
    for (const id of slice.release) byId.get(id)!.deferred = false
    const built = performance.now()
    await setup.renderOnce()
    slices.push(Number((performance.now() - s).toFixed(1)))
    buildMs.push(built - s)
    frameMs.push(performance.now() - built)
    pending = slice.rest
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await setup.renderOnce()
  }
  const finalFrame = JSON.stringify(setup.captureSpans().lines.map((l) => l.spans.map((s) => [s.text, s.fg.r, s.fg.g, s.fg.b, s.attributes])))
  for (const md of byId.values()) md.destroy()
  await setup.renderOnce()
  const eager = await mount()
  const eagerFrame = JSON.stringify(setup.captureSpans().lines.map((l) => l.spans.map((s) => [s.text, s.fg.r, s.fg.g, s.fg.b, s.attributes])))
  console.log(
    JSON.stringify({
      count,
      chars,
      eagerWarmMount: strip(eager),
      bottomUp: {
        deferred: deferredSet.size,
        constructMs: Number((t1 - t0).toFixed(1)),
        firstFrameMs: Number((t2 - t1).toFixed(1)),
        slices: slices.length,
        maxSliceMs: Math.max(0, ...slices),
        totalSliceMs: Number(slices.reduce((a, b) => a + b, 0).toFixed(1)),
        totalBuildMs: Number(buildMs.reduce((a, b) => a + b, 0).toFixed(1)),
        totalFrameMs: Number(frameMs.reduce((a, b) => a + b, 0).toFixed(1)),
        maxBuildMs: Number(Math.max(0, ...buildMs).toFixed(1)),
        maxFrameMs: Number(Math.max(0, ...frameMs).toFixed(1)),
      },
      finalFrameEqualsEager: finalFrame === eagerFrame,
    }),
  )
} else {
  const first = await mount()
  for (const md of first.mounted) md.destroy()
  await setup.renderOnce()
  const again = await mount()
  console.log(JSON.stringify({ count, chars, first: strip(first), remount: strip(again) }))
}
setup.renderer.destroy()
await treeSitterClient.destroy()
process.exit(0)
