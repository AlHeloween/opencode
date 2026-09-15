import { renderMermaidToSvg } from "../../packages/opencode/src/util/mermaid"
import { mkdir } from "node:fs/promises"

const source = await Bun.file("fixtures/feedback-flowchart.mmd").text()
const svg = await renderMermaidToSvg(source, { theme: "dark" })

if (!svg) throw new Error("current mermaid-wasm-renderer did not render the fixture")

await mkdir("output", { recursive: true })
await Bun.write("output/current-wasm.svg", svg)
