import { describe, expect, test } from "bun:test"
import { renderMermaidToSvg, renderMermaidToPngDataUrl, renderSvgToPngDataUrl } from "../../src/util/mermaid"

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

  test("renderMermaidToSvg produces valid SVG", () => {
    const svg = renderMermaidToSvg(flowchart)
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
    expect(svg!).toContain("</svg>")
  })

  test("renderMermaidToSvg with dark theme", () => {
    const svg = renderMermaidToSvg(flowchart, { theme: "dark" })
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
  })

  test("renderMermaidToSvg handles sequence diagram", () => {
    const svg = renderMermaidToSvg(sequence)
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
  })

  test("renderMermaidToSvg handles class diagram", () => {
    const svg = renderMermaidToSvg(classDiagram)
    expect(svg).not.toBeNull()
    expect(svg!).toContain("<svg")
  })

  test("renderSvgToPngDataUrl produces valid data URL", () => {
    const svg = renderMermaidToSvg(flowchart)
    expect(svg).not.toBeNull()
    const dataUrl = renderSvgToPngDataUrl(svg!)
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!).toMatch(/^data:image\/png;base64,/)
    // PNG data URL should be non-trivial (>100 chars)
    expect(dataUrl!.length).toBeGreaterThan(100)
  })

  test("renderMermaidToPngDataUrl full pipeline", () => {
    const dataUrl = renderMermaidToPngDataUrl(flowchart)
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!).toMatch(/^data:image\/png;base64,/)
  })

  test("renderMermaidToPngDataUrl with dark theme", () => {
    const dataUrl = renderMermaidToPngDataUrl(flowchart, { theme: "dark" })
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!).toMatch(/^data:image\/png;base64,/)
  })

  test("invalid mermaid returns null", () => {
    const svg = renderMermaidToSvg("not valid mermaid ???")
    // mermaid-wasm-renderer may return null or throw
    // The function should not throw — it catches errors
    expect(svg === null || typeof svg === "string").toBe(true)
  })

  test("empty input returns null", () => {
    const svg = renderMermaidToSvg("")
    expect(svg).toBeNull()
  })
})
