import { describe, expect, test } from "bun:test"
import {
  nativeImagePixelSize,
  nativeImageCellRows,
  graphicsLayoutMode,
  hasTerminalPixelGeometry,
  hasSixelCellGeometry,
  cellPixelSize,
  mediaImageCellBounds,
  nativeGraphicsLayoutMode,
  solidBorderCropBounds,
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

  test("diagrams use the same terminal-aware contain budget as attachments", () => {
    expect(mediaImageCellBounds({ layout: "diagram", terminalCols: 120, terminalRows: 50 })).toEqual({
      maxCols: 80,
      maxRows: 40,
    })
    expect(mediaImageCellBounds({ layout: "attachment", terminalCols: 120, terminalRows: 50 })).toEqual({
      maxCols: 80,
      maxRows: 40,
    })
  })

  test("diagram crop removes uniform canvas margins while retaining a safety pad", () => {
    const data = new Uint8Array(5 * 5 * 4).fill(0x1a)
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255
    const center = (2 * 5 + 2) * 4
    data[center] = 240
    data[center + 1] = 240
    data[center + 2] = 240

    expect(solidBorderCropBounds({ data, width: 5, height: 5 }, 1)).toEqual({ x: 1, y: 1, w: 3, h: 3 })
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

  test("Sixel remains native when CSI 14t and CSI 16t are unavailable", () => {
    const capabilityOnly = { capabilities: { kitty_graphics: false, sixel: true } }
    expect(nativeGraphicsLayoutMode(capabilityOnly)).toBe("sixel")
    expect(cellPixelSize(capabilityOnly, "sixel")).toEqual({ cellWidth: 12, cellHeight: 20 })

    const resolutionOnly = {
      capabilities: { kitty_graphics: false, sixel: true },
      resolution: { width: 1920, height: 1080 },
      width: 120,
      height: 40,
    }
    expect(hasTerminalPixelGeometry(resolutionOnly)).toBe(true)
    expect(hasSixelCellGeometry(resolutionOnly)).toBe(false)
    expect(nativeGraphicsLayoutMode(resolutionOnly)).toBe("sixel")

    const calibrated = { ...resolutionOnly, cellSize: { width: 8, height: 20 } }
    expect(hasSixelCellGeometry(calibrated)).toBe(true)
    expect(nativeGraphicsLayoutMode(calibrated)).toBe("sixel")
  })

  test("Sixel uses direct terminal cell pixels rather than DPI-scaled window pixels", () => {
    expect(
      cellPixelSize(
        {
          capabilities: { kitty_graphics: false, sixel: true },
          resolution: { width: 1920, height: 1080 },
          width: 120,
          height: 40,
          cellSize: { width: 8, height: 20 },
        },
        "sixel",
      ),
    ).toEqual({ cellWidth: 8, cellHeight: 20 })
  })

  test("native image row reservation contains the pixel plane and box padding", () => {
    expect(nativeImageCellRows(240, 20)).toBe(12)
    expect(nativeImageCellRows(241, 20)).toBe(13)
  })

  test("Kitty graphics do not require Sixel geometry calibration", () => {
    expect(
      nativeGraphicsLayoutMode({
        capabilities: { kitty_graphics: true, sixel: false },
      }),
    ).toBe("kitty")
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
