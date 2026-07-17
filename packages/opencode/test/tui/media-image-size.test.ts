import { describe, expect, test } from "bun:test"
import {
  nativeImagePixelSize,
  graphicsLayoutMode,
  cellPixelSize,
} from "../../src/cli/cmd/tui/component/media-image"

describe("MediaImage native pixel sizing (contain-fit)", () => {
  test("preserves natural mermaid size when it fits", () => {
    const size = nativeImagePixelSize({
      srcWidth: 296,
      srcHeight: 433,
      maxCols: 80,
      maxRows: 40,
      mode: "sixel",
      cellWidth: 18,
      cellHeight: 35,
    })
    // 296×433 fits in 80*18 × 40*35 — keep natural (sixel may pad height to %6)
    expect(size.width).toBe(296)
    expect(size.height % 6).toBe(0)
    expect(size.height).toBeGreaterThanOrEqual(433)
    expect(size.height).toBeLessThanOrEqual(438)
  })

  test("does not stretch to fixed ~600 width", () => {
    const size = nativeImagePixelSize({
      srcWidth: 450,
      srcHeight: 350,
      maxCols: 60,
      maxRows: 40,
      mode: "kitty",
      cellWidth: 10,
      cellHeight: 20,
    })
    // max budget is 600×800 but source is smaller — keep 450×350
    expect(size.width).toBe(450)
    expect(size.height).toBe(350)
  })

  test("tall 100×10000 is height-limited", () => {
    const size = nativeImagePixelSize({
      srcWidth: 100,
      srcHeight: 10000,
      maxCols: 80,
      maxRows: 40,
      mode: "kitty",
      cellWidth: 18,
      cellHeight: 35,
    })
    const maxH = 40 * 35
    expect(size.height).toBeLessThanOrEqual(maxH)
    // aspect ~1:100
    expect(size.width).toBeLessThanOrEqual(Math.ceil(100 * (maxH / 10000)) + 1)
  })

  test("wide source is width-limited to maxCols cells", () => {
    const size = nativeImagePixelSize({
      srcWidth: 3000,
      srcHeight: 400,
      maxCols: 80,
      maxRows: 40,
      mode: "sixel",
      cellWidth: 18,
      cellHeight: 35,
    })
    expect(size.width).toBe(80 * 18)
    expect(size.height % 6).toBe(0)
  })

  test("graphicsLayoutMode prefers kitty over sixel", () => {
    expect(
      graphicsLayoutMode({
        capabilities: { kitty_graphics: true, sixel: true },
      }),
    ).toBe("kitty")
    expect(
      graphicsLayoutMode({
        capabilities: { kitty_graphics: false, sixel: true },
      }),
    ).toBe("sixel")
    expect(graphicsLayoutMode({ capabilities: null })).toBe("none")
  })

  test("cellPixelSize uses resolution when available", () => {
    const cells = cellPixelSize({
      capabilities: { kitty_graphics: true },
      resolution: { width: 1600, height: 900 },
      width: 100,
      height: 30,
    })
    expect(cells.cellWidth).toBe(16)
    expect(cells.cellHeight).toBe(30)
  })

  test("cellPixelSize falls back to OpenTUI defaults", () => {
    const cells = cellPixelSize({ capabilities: null })
    expect(cells.cellWidth).toBe(18)
    expect(cells.cellHeight).toBe(35)
  })
})
