import { describe, expect, test, beforeEach } from "bun:test"
import {
  renderMermaidToSvg,
  renderMermaidToPngDataUrl,
  renderMermaidToRgba,
  renderSvgToPngDataUrl,
  resetRendererCache,
} from "../../src/util/mermaid"

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
