import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import { renderMermaidToRgba, renderMermaidToSvg, renderSvgToRgba, resetRendererCache } from "../../src/util/mermaid"

setDefaultTimeout(20_000)

// Requirement: one monospace letter advances one measured terminal column.
const labels = "flowchart LR\n A[MMMM] --> B[MMMMMMMM]"
const nodeWidths = (svg: string) =>
  [...svg.matchAll(/<rect\b[^>]*?\swidth="([\d.]+)"/g)].slice(1).map((m) => Number(m[1]))

describe("Mermaid text uses terminal columns before layout", () => {
  test("reset registers the same font in the replacement WASM renderer", async () => {
    const before = await renderMermaidToSvg(labels, { cellWidth: 12 })
    resetRendererCache()
    const after = await renderMermaidToSvg(labels, { cellWidth: 12 })
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(nodeWidths(after!)).toEqual(nodeWidths(before!))
  })
  test("letter advance follows the terminal cell, rather than diagram width", async () => {
    for (const cellWidth of [12, 24]) {
      const svg = await renderMermaidToSvg(labels, { cellWidth })
      expect(svg).not.toBeNull()
      const widths = nodeWidths(svg!)
      expect(widths).toHaveLength(2)
      expect((widths[1]! - widths[0]!) / 4).toBeCloseTo(cellWidth, 1)
    }
  })

  test("a long chain keeps the same label size as a short diagram", async () => {
    const short = await renderMermaidToSvg(labels, { cellWidth: 12 })
    const wide = await renderMermaidToSvg(labels + "\n B --> C[MMMM] --> D[MMMM] --> E[MMMM]", { cellWidth: 12 })
    expect(short).not.toBeNull()
    expect(wide).not.toBeNull()
    const labelSize = (svg: string) => Number(svg.match(/font-size="([\d.]+)"/)?.[1])
    expect(labelSize(wide!)).toBe(labelSize(short!))
    const frame = renderSvgToRgba(wide!)!
    const natural = new Resvg(wide!).render()
    expect(frame.width).toBe(natural.width)
    expect(frame.height).toBe(natural.height)
  })

  test("the frame cache separates terminal font sizes", async () => {
    const small = await renderMermaidToRgba(labels, { cellWidth: 12 })
    const same = await renderMermaidToRgba(labels, { cellWidth: 12 })
    const large = await renderMermaidToRgba(labels, { cellWidth: 24 })
    expect(small).not.toBeNull()
    expect(same).toBe(small)
    expect(large).not.toBe(small)
    expect(large!.width).toBeGreaterThan(small!.width)
  })
})
