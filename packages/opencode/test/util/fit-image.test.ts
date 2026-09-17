import { describe, expect, test } from "bun:test"
import {
  fitContainSize,
  fitFontAnchoredSize,
  fitToWidthSize,
  parseSvgFontSize,
  parseSvgNaturalSize,
} from "../../src/util/fit-image"

describe("fitContainSize", () => {
  test("keeps natural size when already inside the box", () => {
    const r = fitContainSize({
      srcWidth: 296,
      srcHeight: 433,
      maxWidth: 1440,
      maxHeight: 800,
      allowUpscale: false,
    })
    expect(r.width).toBe(296)
    expect(r.height).toBe(433)
    expect(r.scale).toBe(1)
  })

  test("does not force a fixed width like 600", () => {
    const r = fitContainSize({
      srcWidth: 450,
      srcHeight: 350,
      maxWidth: 600,
      maxHeight: 2000,
      allowUpscale: false,
    })
    expect(r.width).toBe(450)
    expect(r.height).toBe(350)
  })

  test("tall 100×10000 shrinks to height budget, preserves aspect", () => {
    const r = fitContainSize({
      srcWidth: 100,
      srcHeight: 10000,
      maxWidth: 1440,
      maxHeight: 800,
      allowUpscale: false,
    })
    expect(r.height).toBe(800)
    expect(r.width).toBe(8) // 100 * (800/10000)
    expect(r.scale).toBeCloseTo(0.08, 5)
  })

  test("wide diagram shrinks to width budget", () => {
    const r = fitContainSize({
      srcWidth: 2000,
      srcHeight: 500,
      maxWidth: 1000,
      maxHeight: 2000,
      allowUpscale: false,
    })
    expect(r.width).toBe(1000)
    expect(r.height).toBe(250)
  })

  test("allowUpscale can enlarge small vector sources", () => {
    const r = fitContainSize({
      srcWidth: 100,
      srcHeight: 50,
      maxWidth: 400,
      maxHeight: 400,
      allowUpscale: true,
    })
    expect(r.width).toBe(400)
    expect(r.height).toBe(200)
    expect(r.scale).toBe(4)
  })
})

describe("fitToWidthSize", () => {
  test("sets width; height is automatic from aspect (not maxHeight)", () => {
    const r = fitToWidthSize({
      srcWidth: 100,
      srcHeight: 10000,
      width: 200,
      allowUpscale: true,
    })
    expect(r.width).toBe(200)
    expect(r.height).toBe(20000) // height free — tall stays tall
    expect(r.scale).toBe(2)
  })

  test("large diagrams always match given width", () => {
    const r = fitToWidthSize({
      srcWidth: 2000,
      srcHeight: 500,
      width: 800,
      allowUpscale: true,
    })
    expect(r.width).toBe(800)
    expect(r.height).toBe(200)
  })

  test("without upscale, small sources keep natural width", () => {
    const r = fitToWidthSize({
      srcWidth: 100,
      srcHeight: 50,
      width: 400,
      allowUpscale: false,
    })
    expect(r.width).toBe(100)
    expect(r.height).toBe(50)
  })
})

describe("parseSvgNaturalSize", () => {
  test("reads width/height attributes", () => {
    const s = parseSvgNaturalSize(`<svg width="296.3" height="432.6" viewBox="0 0 296 432"></svg>`)
    expect(s).toEqual({ width: 296.3, height: 432.6 })
  })

  test("falls back to viewBox", () => {
    const s = parseSvgNaturalSize(`<svg viewBox="0 0 100 10000" xmlns="http://www.w3.org/2000/svg"></svg>`)
    expect(s).toEqual({ width: 100, height: 10000 })
  })
})

describe("parseSvgFontSize", () => {
  test("reads a px font-size from a style declaration", () => {
    expect(parseSvgFontSize(`<svg><style>.label{font-size:14px;fill:#333}</style></svg>`)).toBe(14)
  })

  test("reads a unitless font-size attribute", () => {
    expect(parseSvgFontSize(`<svg><text font-size="18">hi</text></svg>`)).toBe(18)
  })

  test("picks the most frequent size, not the first", () => {
    const svg = `<svg><text font-size="28">title</text>
      <text font-size="14">a</text><text font-size="14">b</text><text font-size="14">c</text></svg>`
    expect(parseSvgFontSize(svg)).toBe(14)
  })

  test("returns null when the SVG declares no font size", () => {
    expect(parseSvgFontSize(`<svg><rect width="10" height="10"/></svg>`)).toBeNull()
  })
})

describe("fitFontAnchoredSize", () => {
  // The whole point: apparent text size must stop depending on the diagram.
  // Measured on real mermaid output 2026-09-18 — a 14px label rendered at 136px
  // in a two-node graph and 6px in a twelve-node chain on the same terminal,
  // purely because width-filling made the scale a function of node count.
  const CELL_H = 20
  const FONT = 14

  const renderedFontPx = (srcWidth: number, maxWidth: number) =>
    fitFontAnchoredSize({
      srcWidth,
      srcHeight: 100,
      srcFontPx: FONT,
      cellHeight: CELL_H,
      maxWidth,
    }).scale * FONT

  test("diagrams of very different natural width render text at the same size", () => {
    // Natural widths taken from the probe: 123px (2 nodes) and 155px (6 nodes).
    expect(renderedFontPx(123, 1200)).toBeCloseTo(renderedFontPx(155, 1200), 10)
  })

  test("one label line is exactly one terminal row tall by default", () => {
    expect(renderedFontPx(123, 1200)).toBeCloseTo(CELL_H, 10)
  })

  test("labelCells scales the anchor proportionally", () => {
    const one = fitFontAnchoredSize({
      srcWidth: 123,
      srcHeight: 100,
      srcFontPx: FONT,
      cellHeight: CELL_H,
      maxWidth: 100000,
    })
    const two = fitFontAnchoredSize({
      srcWidth: 123,
      srcHeight: 100,
      srcFontPx: FONT,
      cellHeight: CELL_H,
      labelCells: 2,
      maxWidth: 100000,
    })
    expect(two.scale).toBeCloseTo(one.scale * 2, 10)
  })

  test("text scale follows the terminal font, not the diagram", () => {
    // Doubling the cell (a bigger terminal font) doubles the rendered label.
    const small = fitFontAnchoredSize({
      srcWidth: 123,
      srcHeight: 100,
      srcFontPx: FONT,
      cellHeight: 10,
      maxWidth: 100000,
    })
    const large = fitFontAnchoredSize({
      srcWidth: 123,
      srcHeight: 100,
      srcFontPx: FONT,
      cellHeight: 20,
      maxWidth: 100000,
    })
    expect(large.scale).toBeCloseTo(small.scale * 2, 10)
  })

  test("width is a clamp: a diagram too wide to fit shrinks and says so", () => {
    // 2755px natural (the twelve-node chain) cannot fit 1200px at any anchor.
    const r = fitFontAnchoredSize({
      srcWidth: 2755,
      srcHeight: 75,
      srcFontPx: FONT,
      cellHeight: CELL_H,
      maxWidth: 1200,
    })
    expect(r.clamped).toBe(true)
    expect(r.width).toBeLessThanOrEqual(1200)
  })

  test("a narrow diagram is never blown up to fill the width", () => {
    const r = fitFontAnchoredSize({
      srcWidth: 123,
      srcHeight: 161,
      srcFontPx: FONT,
      cellHeight: CELL_H,
      maxWidth: 1200,
    })
    expect(r.clamped).toBe(false)
    // Old behaviour forced exactly 1200 here — a 9.7x upscale.
    expect(r.width).toBeLessThan(400)
  })

  test("aspect ratio is preserved", () => {
    const r = fitFontAnchoredSize({
      srcWidth: 200,
      srcHeight: 100,
      srcFontPx: FONT,
      cellHeight: CELL_H,
      maxWidth: 1200,
    })
    expect(r.width / r.height).toBeCloseTo(2, 2)
  })

  test("a missing font size falls back instead of producing a zero scale", () => {
    const r = fitFontAnchoredSize({
      srcWidth: 123,
      srcHeight: 100,
      srcFontPx: 0,
      cellHeight: CELL_H,
      maxWidth: 1200,
    })
    expect(r.scale).toBeGreaterThan(0)
    expect(Number.isFinite(r.scale)).toBe(true)
  })
})
