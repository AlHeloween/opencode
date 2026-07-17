import { describe, expect, test } from "bun:test"
import {
  nativeImagePixelSize,
  graphicsLayoutMode,
  cellPixelSize,
} from "../../src/cli/cmd/tui/component/media-image"

describe("MediaImage native pixel sizing", () => {
  test("sixel: high-res screen pixels (not 1px/cell), height multiple of 6", () => {
    // Old bug: resized to 80×N → stamp-sized on Windows Terminal sixel.
    const size = nativeImagePixelSize({
      srcWidth: 960,
      srcHeight: 400,
      maxCols: 80,
      mode: "sixel",
      cellWidth: 18,
      cellHeight: 35,
    })
    expect(size.width).toBe(80 * 18)
    expect(size.height % 6).toBe(0)
    // Layout cells ≈ maxCols when Image uses cell metrics
    expect(Math.ceil(size.width / 18)).toBe(80)
  })

  test("kitty: fills maxCols at real cell pixels", () => {
    const size = nativeImagePixelSize({
      srcWidth: 960,
      srcHeight: 400,
      maxCols: 80,
      mode: "kitty",
      cellWidth: 18,
      cellHeight: 35,
    })
    expect(size.width).toBe(80 * 18)
    expect(size.height).toBe(Math.round((80 * 18) / (960 / 400)))
    expect(Math.ceil(size.width / 18)).toBe(80)
    expect(Math.ceil(size.height / 35)).toBeGreaterThan(5)
  })

  test("sixel and kitty share the same column pixel budget", () => {
    const sixel = nativeImagePixelSize({
      srcWidth: 1200,
      srcHeight: 600,
      maxCols: 60,
      mode: "sixel",
      cellWidth: 10,
      cellHeight: 20,
    })
    const kitty = nativeImagePixelSize({
      srcWidth: 1200,
      srcHeight: 600,
      maxCols: 60,
      mode: "kitty",
      cellWidth: 10,
      cellHeight: 20,
    })
    expect(sixel.width).toBe(kitty.width)
    expect(sixel.width).toBe(600)
    // sixel may pad height to band of 6
    expect(sixel.height).toBeGreaterThanOrEqual(kitty.height)
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
