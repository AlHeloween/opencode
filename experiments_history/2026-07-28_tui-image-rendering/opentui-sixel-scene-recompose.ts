import { BoxRenderable, ImageRenderable, TextRenderable, createCliRenderer } from "../../packages/opentui/packages/core/src/index.ts"
import { Resvg } from "../../packages/opencode/node_modules/@resvg/resvg-js/index.js"
import { renderMermaidToSvg, resvgOptionsForSvg } from "../../packages/opencode/src/util/mermaid"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
renderer.setBackgroundColor("#1a1b26")
renderer.start()
renderer.root.add(new BoxRenderable(renderer, { width: renderer.width, height: renderer.height, backgroundColor: "#1a1b26" }))

const status = new TextRenderable(renderer, {
  content: "Sixel retained-scene test: waiting to move diagram",
  position: "absolute",
  left: 2,
  top: 1,
  fg: "#c0caf5",
})
renderer.root.add(status)

const svg = await renderMermaidToSvg("flowchart LR\n  A[old plane] --> B[new plane]")
if (!svg) throw new Error("Mermaid SVG renderer returned null")
const frame = new Resvg(svg, resvgOptionsForSvg(svg, "#1a1b26", { maxWidth: 420, maxHeight: 180 })).render()
const image = new ImageRenderable(renderer, {
  data: frame.pixels,
  imageWidth: frame.width,
  imageHeight: frame.height,
  position: "absolute",
  left: 2,
  top: 3,
})
renderer.root.add(image)

await wait(2_000)
image.top = 20
status.content = "Sixel retained-scene test: diagram moved to row 20; old plane must be gone"

renderer.keyInput.on("keypress", (key) => {
  if (key.name !== "escape" && key.name !== "q") return
  renderer.destroy()
  process.exit(0)
})
setTimeout(() => {
  renderer.destroy()
  process.exit(0)
}, 120_000)
