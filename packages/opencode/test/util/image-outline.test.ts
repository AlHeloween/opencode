import { expect, test } from "bun:test"
import { halfBlockMap, outlineFromGray, outlineToSvg, outlineToText, toGray } from "../../src/util/image-outline"

// 8x4 black field with a white bar at rows 1-2, columns 2-5.
const W = 8
const H = 4
const rgba = new Uint8Array(W * H * 4)
for (let y = 1; y <= 2; y++) {
  for (let x = 2; x <= 5; x++) {
    const p = (y * W + x) * 4
    rgba[p] = 255
    rgba[p + 1] = 255
    rgba[p + 2] = 255
    rgba[p + 3] = 255
  }
}
const gray = toGray(rgba, W, H)

test("the bands land on the drawn bar and nowhere else", () => {
  const outline = outlineFromGray(gray, W, H)
  expect(outline.rows).toEqual([{ start: 1, end: 2 }])
  expect(outline.cols).toEqual([{ start: 2, end: 5 }])
  expect(outline.density).toBeCloseTo(8 / 32, 5)
})

test("the text map renders the bar with half blocks", () => {
  const lines = halfBlockMap(gray, W, H, 8).split("\n")
  expect(lines.length).toBe(2)
  expect(lines[0]!.includes("▄")).toBe(true) // black top, white bottom
  expect(lines[1]!.includes("▀")).toBe(true) // white top, black bottom
})

test("the SVG carries the raster, both bands and a labelled box", () => {
  const svg = outlineToSvg({
    outline: outlineFromGray(gray, W, H),
    dataUrl: "data:image/png;base64,AAAA",
    boxes: [{ x: 1, y: 1, w: 6, h: 2, label: "toolbar lives here" }],
  })
  expect(svg).toContain("<image")
  expect(svg).toContain("toolbar lives here")
  expect((svg.match(/<rect/g) ?? []).length).toBe(3) // one row band + one column band + one box
})

test("the text summary names the size and both bands", () => {
  const text = outlineToText(outlineFromGray(gray, W, H))
  expect(text).toContain("8x4")
  expect(text).toContain("1-2")
  expect(text).toContain("2-5")
})
