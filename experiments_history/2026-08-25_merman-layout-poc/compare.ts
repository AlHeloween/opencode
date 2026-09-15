import { createHash } from "node:crypto"
import { Resvg } from "../../packages/opencode/node_modules/@resvg/resvg-js/index.js"
import { resvgOptionsForSvg } from "../../packages/opencode/src/util/mermaid"

const background = "#1a1b26"
const containBudget = { maxWidth: 720, maxHeight: 480 }
const names = ["current-wasm", "merman-resvg-safe"] as const

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`))?.[1] ?? null
}

function numbers(value: string | null) {
  return value?.match(/-?[0-9]*[.]?[0-9]+(?:e[+-]?[0-9]+)?/gi)?.map(Number) ?? []
}

function svgMetrics(svg: string) {
  const tag = svg.match(/<svg[ >][^>]*>/i)?.[0] ?? ""
  const viewBox = numbers(attr(tag, "viewBox"))
  const width = attr(tag, "width")
  const height = attr(tag, "height")
  return {
    sha256: createHash("sha256").update(svg).digest("hex"),
    bytes: Buffer.byteLength(svg),
    width,
    height,
    viewBox,
    viewBoxArea: viewBox.length === 4 ? viewBox[2] * viewBox[3] : null,
  }
}

const result = await Promise.all(
  names.map(async (name) => {
    const svg = await Bun.file(`output/${name}.svg`).text()
    const png = new Resvg(svg, resvgOptionsForSvg(svg, background, containBudget)).render()
    await Bun.write(`output/${name}.png`, png.asPng())
    return [name, { ...svgMetrics(svg), png: { width: png.width, height: png.height } }] as const
  }),
)

await Bun.write(
  "output/report.json",
  JSON.stringify(
    {
      fixture: "fixtures/feedback-flowchart.mmd",
      fixtureSha256: createHash("sha256").update(await Bun.file("fixtures/feedback-flowchart.mmd").text()).digest("hex"),
      background,
      containBudget,
      rendererConfig: {
        currentWasm: { package: "mermaid-wasm-renderer@0.3.1", theme: "dark" },
        merman: { package: "merman@0.7.0", theme: "HostThemeProfile::editor_dark", output: "resvg-safe SVG" },
      },
      artifacts: Object.fromEntries(result),
      feedbackEdgeReview: {
        currentWasm: "No -> Start follows a wide external route around the decision branch.",
        merman: "No -> Start uses a compact left channel between Start and OK?; Yes and No remain legible.",
      },
    },
    null,
    2,
  ) + "\n",
)
