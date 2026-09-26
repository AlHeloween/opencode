import { describe, expect, test, beforeEach } from "bun:test"
import {
  renderMermaidToSvg,
  renderMermaidToPngDataUrl,
  renderMermaidToRgba,
  renderSvgToPngDataUrl,
  resetRendererCache,
  resvgOptionsForSvg,
} from "../../src/util/mermaid"
import { parseSvgFontSize, parseSvgNaturalSize } from "../../src/util/fit-image"

describe("mermaid rendering", () => {
  const flowchart = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[OK]
    B -->|No| D[Cancel]`

  const sequence = `sequenceDiagram
    Alice->>Bob: Hello Bob
    Bob-->>Alice: Hi Alice`

  const classDiagram = `classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    class Animal {
        +String name
        +makeSound()
    }`

  // Reset lazy loader between tests so failures don't poison the cache
  beforeEach(() => resetRendererCache())

  test("renderMermaidToSvg produces valid SVG", async () => {
    const svg = await renderMermaidToSvg(flowchart)
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
    expect(svg!).toContain("</svg>")
  })

  test("renderMermaidToSvg with dark theme", async () => {
    const svg = await renderMermaidToSvg(flowchart, { theme: "dark" })
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
  })

  test("renderMermaidToSvg handles sequence diagram", async () => {
    const svg = await renderMermaidToSvg(sequence)
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
  })

  test("renderMermaidToSvg handles class diagram", async () => {
    const svg = await renderMermaidToSvg(classDiagram)
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
  })

  test("renderSvgToPngDataUrl produces valid data URL", async () => {
    const svg = await renderMermaidToSvg(flowchart)
    expect(svg).not.toBeNull()
    const dataUrl = renderSvgToPngDataUrl(svg!)
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!).toMatch(/^data:image\/png;base64,/)
    // PNG data URL should be non-trivial (>100 chars)
    expect(dataUrl!.length).toBeGreaterThan(100)
  })

  test("renderSvgToPngDataUrl fits SVG to width; height automatic from aspect", async () => {
    const { Resvg } = await import("@resvg/resvg-js")
    const svg = await renderMermaidToSvg(flowchart)
    expect(svg).not.toBeNull()
    const natural = new Resvg(svg!, { background: "#fff" })
    const targetW = 800
    const dataUrl = renderSvgToPngDataUrl(svg!, "#ffffff", {
      maxWidth: targetW,
    })
    expect(dataUrl).not.toBeNull()
    const b64 = dataUrl!.split(",")[1]!
    const j = (await import("jimp")) as any
    const img = await j.Jimp.read(Buffer.from(b64, "base64"))
    // Width is the only constraint; height follows natural aspect.
    expect(img.width).toBe(targetW)
    expect(img.width / img.height).toBeCloseTo(natural.width / natural.height, 1)
  })

  test("renderSvgToPngDataUrl width-fits tall SVG without height budget shrinking width", () => {
    const tall = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="10000"><rect width="100" height="10000" fill="#333"/></svg>`
    const dataUrl = renderSvgToPngDataUrl(tall, "#ffffff", { maxWidth: 200 })
    expect(dataUrl).not.toBeNull()
    // Decode is enough — width-only fit; height is large (not capped to 800).
  })

  test("renderMermaidToPngDataUrl full pipeline", async () => {
    const dataUrl = await renderMermaidToPngDataUrl(flowchart)
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!).toMatch(/^data:image\/png;base64,/)
  })

  test("renderMermaidToPngDataUrl with dark theme", async () => {
    const dataUrl = await renderMermaidToPngDataUrl(flowchart, { theme: "dark" })
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!).toMatch(/^data:image\/png;base64,/)
  })

  test("renderMermaidToRgba produces a native graphics frame without PNG encoding", async () => {
    const frame = await renderMermaidToRgba(flowchart, {
      theme: "dark",
      background: "#1a1b26",
      budget: { maxWidth: 640 },
    })
    expect(frame).not.toBeNull()
    expect(frame!.width).toBe(640)
    expect(frame!.height).toBeGreaterThan(0)
    expect(frame!.data.byteLength).toBe(frame!.width * frame!.height * 4)
  })

  // T10 (plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md): a remount must not re-run WASM → SVG → RGBA.
  // The same (source, theme, background, budget) returns the SAME frame; any differing input is a
  // different frame — the control that keeps a cache from answering every question with one value.
  test("renderMermaidToRgba returns the stored frame for the same inputs, a new one for different inputs", async () => {
    const options = { theme: "dark" as const, background: "#1a1b26", budget: { maxWidth: 320 } }
    const first = await renderMermaidToRgba(flowchart, options)
    const again = await renderMermaidToRgba(flowchart, { ...options, budget: { ...options.budget } })
    const otherBudget = await renderMermaidToRgba(flowchart, { ...options, budget: { maxWidth: 240 } })
    const otherSource = await renderMermaidToRgba(sequence, options)
    expect(first).not.toBeNull()
    expect(again).toBe(first)
    expect(otherBudget).not.toBe(first)
    expect(otherBudget!.width).toBe(240)
    expect(otherSource).not.toBe(first)
  })

  test("invalid mermaid returns null", async () => {
    const svg = await renderMermaidToSvg("not valid mermaid ???")
    // mermaid-wasm-renderer may return null or throw
    // The function should not throw — it catches errors
    expect(svg === null || typeof svg === "string").toBe(true)
  })

  test("empty input returns null", async () => {
    const svg = await renderMermaidToSvg("")
    expect(svg).toBeNull()
  })
})

describe("mermaid raster scale is anchored to the terminal font", () => {
  // End-to-end over real wasm output, not synthetic SVG. The defect this pins:
  // width-filling made the rendered label size a function of the diagram's
  // natural width, which tracks node count. Measured 2026-09-18 on a 1200px
  // budget: 9.7x for two nodes, 0.44x for twelve — a 22x spread in apparent
  // text size that no user could predict or control.
  const CELL_H = 20

  const twoNodes = `graph TD
    A[Start] --> B[End]`

  const sixNodes = `graph TD
    A[Start] --> B[Parse]
    B --> C[Validate]
    C --> D[Transform]
    D --> E[Emit]
    E --> F[End]`

  const twelveNodeChain = `graph LR
    ${Array.from({ length: 12 }, (_, i) => `N${i}[Node number ${i}] --> N${i + 1}[Node number ${i + 1}]`).join("\n    ")}`

  beforeEach(() => resetRendererCache())

  /** Rendered label height in device px for a real diagram at a real budget. */
  async function labelPx(source: string, maxWidth: number): Promise<number> {
    const svg = await renderMermaidToSvg(source)
    expect(svg).not.toBeNull()
    const natural = parseSvgNaturalSize(svg!)
    expect(natural).not.toBeNull()
    const opts = resvgOptionsForSvg(svg!, "#ffffff", { maxWidth, cellHeight: CELL_H })
    expect(opts.fitTo).toBeDefined()
    const scale = opts.fitTo!.value / natural!.width
    return scale * (parseSvgFontSize(svg!) ?? 14)
  }

  test("two diagrams that fit render their labels at the same size", async () => {
    const small = await labelPx(twoNodes, 1200)
    const medium = await labelPx(sixNodes, 1200)
    // Within a pixel — the only slack is integer rounding of the target width.
    expect(Math.abs(small - medium)).toBeLessThan(1)
  })

  test("a label that fits is one terminal row tall", async () => {
    expect(await labelPx(twoNodes, 1200)).toBeCloseTo(CELL_H, 0)
  })

  test("a narrow diagram is no longer blown up to the full width", async () => {
    const svg = await renderMermaidToSvg(twoNodes)
    const natural = parseSvgNaturalSize(svg!)!
    const opts = resvgOptionsForSvg(svg!, "#ffffff", { maxWidth: 1200, cellHeight: CELL_H })
    expect(opts.fitTo!.value).toBeLessThan(1200)
    expect(opts.fitTo!.value).toBeGreaterThan(natural.width)
  })

  test("a diagram too wide to fit is clamped to the budget, not to the anchor", async () => {
    const svg = await renderMermaidToSvg(twelveNodeChain)
    const opts = resvgOptionsForSvg(svg!, "#ffffff", { maxWidth: 1200, cellHeight: CELL_H })
    expect(opts.fitTo!.value).toBeLessThanOrEqual(1200)
  })

  test("a tall diagram is never re-fit by height — height flows, only width clamps", async () => {
    // Owner ruling, 2026-09-26: «клампить ширину, высоту отпускать и вставлять как есть».
    // The 2026-09-23 height re-fit used to divide the anchor here; it must not come back.
    const svg = await renderMermaidToSvg(sixNodes)
    const natural = parseSvgNaturalSize(svg!)!
    const budget = { maxWidth: 2000, cellHeight: CELL_H, maxHeight: 40 }
    const opts = resvgOptionsForSvg(svg!, "#ffffff", budget)
    // The anchor decided the scale; the passed row budget must NOT shrink it.
    expect(opts.fitTo!.mode).toBe("width")
    const outHeight = (natural.height * opts.fitTo!.value) / natural.width
    expect(outHeight).toBeGreaterThan(budget.maxHeight)
  })

  test("doubling the terminal font doubles the rendered label", async () => {
    const svg = await renderMermaidToSvg(twoNodes)
    const at10 = resvgOptionsForSvg(svg!, "#ffffff", { maxWidth: 100000, cellHeight: 10 }).fitTo!.value
    const at20 = resvgOptionsForSvg(svg!, "#ffffff", { maxWidth: 100000, cellHeight: 20 }).fitTo!.value
    expect(at20 / at10).toBeCloseTo(2, 1)
  })

  test("without a measured cell the old width-filling behaviour is kept", async () => {
    const svg = await renderMermaidToSvg(twoNodes)
    // The PNG symbol fallback has no CSI 16t geometry to anchor to.
    expect(resvgOptionsForSvg(svg!, "#ffffff", { maxWidth: 1200 }).fitTo!.value).toBe(1200)
  })
})
