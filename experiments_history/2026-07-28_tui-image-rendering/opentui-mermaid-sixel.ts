import { BoxRenderable, ImageRenderable, TextRenderable, createCliRenderer } from "../../packages/opentui/packages/core/src/index.ts"
import { Resvg } from "../../packages/opencode/node_modules/@resvg/resvg-js/index.js"
import { renderMermaidToSvg, resvgOptionsForSvg } from "../../packages/opencode/src/util/mermaid"

const source = [
  "flowchart LR",
  "  A[OpenTUI] --> B{Cell metrics}",
  "  B -->|CSI 16t| C[Calibrated Sixel]",
  "  B -->|missing| D[Safe fallback]",
].join("\n")

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
renderer.setBackgroundColor("#1a1b26")
renderer.start()

renderer.root.add(
  new BoxRenderable(renderer, {
    id: "background",
    width: renderer.width,
    height: renderer.height,
    backgroundColor: "#1a1b26",
  }),
)

renderer.root.add(
  new TextRenderable(renderer, {
    id: "title",
    content: "OpenTUI Mermaid → ImageRenderable → Sixel",
    position: "absolute",
    left: 2,
    top: 1,
    fg: "#c0caf5",
  }),
)

await wait(750)

const svg = await renderMermaidToSvg(source, { theme: "dark" })
if (!svg) throw new Error("Mermaid SVG renderer returned null")

const png = new Resvg(
  svg,
  resvgOptionsForSvg(svg, "#1a1b26", {
    maxWidth: 512,
    maxHeight: 260,
  }),
).render()

const image = new ImageRenderable(renderer, {
  id: "mermaid",
  data: png.pixels,
  imageWidth: png.width,
  imageHeight: png.height,
  position: "absolute",
  left: 2,
  top: 3,
})
renderer.root.add(image)

const cellSize = renderer.cellSize ? `${renderer.cellSize.width}×${renderer.cellSize.height}px` : "unavailable"
const capabilities = JSON.stringify(renderer.capabilities ?? {})
renderer.root.add(
  new TextRenderable(renderer, {
    id: "diagnostics",
    content: `PNG ${png.width}×${png.height}px | cell ${cellSize} | caps ${capabilities}`,
    position: "absolute",
    left: 2,
    top: Math.min(renderer.height - 3, image.height + 5),
    fg: "#7aa2f7",
  }),
)
renderer.root.add(
  new TextRenderable(renderer, {
    id: "exit",
    content: "Esc or q: exit",
    position: "absolute",
    left: 2,
    top: renderer.height - 1,
    fg: "#565f89",
  }),
)

renderer.keyInput.on("keypress", (key) => {
  if (key.name !== "escape" && key.name !== "q") return
  renderer.destroy()
  process.exit(0)
})

setTimeout(() => {
  renderer.destroy()
  process.exit(0)
}, 120_000)
