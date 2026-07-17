import { describe, expect, test } from "bun:test"
import {
  clampZoom,
  viewportCrop,
  clampPan,
  sampleViewport,
  zoomByWheel,
  panByCells,
} from "../../src/util/image-viewport"

describe("image viewport zoom/pan", () => {
  test("clampZoom bounds", () => {
    expect(clampZoom(0.5)).toBe(1)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(100)).toBe(12)
  })

  test("viewportCrop at zoom 1 covers most of source when aspect matches", () => {
    const crop = viewportCrop(400, 300, 400, 300, { zoom: 1, panX: 0, panY: 0 })
    expect(crop.cropW).toBeCloseTo(400, 0)
    expect(crop.cropH).toBeCloseTo(300, 0)
    expect(crop.x0).toBeCloseTo(0, 0)
    expect(crop.y0).toBeCloseTo(0, 0)
  })

  test("viewportCrop at zoom 2 halves visible region", () => {
    const crop = viewportCrop(400, 300, 400, 300, { zoom: 2, panX: 0, panY: 0 })
    expect(crop.cropW).toBeCloseTo(200, 0)
    expect(crop.cropH).toBeCloseTo(150, 0)
    // Centered
    expect(crop.x0).toBeCloseTo(100, 0)
    expect(crop.y0).toBeCloseTo(75, 0)
  })

  test("clampPan keeps crop inside source", () => {
    const clamped = clampPan(400, 300, 400, 300, { zoom: 2, panX: 9999, panY: -9999 })
    const crop = viewportCrop(400, 300, 400, 300, clamped)
    expect(crop.x0).toBeGreaterThanOrEqual(0)
    expect(crop.y0).toBeGreaterThanOrEqual(0)
    expect(crop.x0 + crop.cropW).toBeLessThanOrEqual(400 + 0.01)
    expect(crop.y0 + crop.cropH).toBeLessThanOrEqual(300 + 0.01)
  })

  test("sampleViewport produces outW*outH*4 bytes", () => {
    // 2×2 red/blue checker
    const src = new Uint8Array([
      255, 0, 0, 255, 0, 0, 255, 255, // row0
      0, 255, 0, 255, 255, 255, 0, 255, // row1
    ])
    const out = sampleViewport(src, 2, 2, 4, 4, { zoom: 1, panX: 0, panY: 0 })
    expect(out.length).toBe(4 * 4 * 4)
  })

  test("zoomByWheel up increases zoom, down resets toward 1", () => {
    let s = { zoom: 1, panX: 0, panY: 0 }
    s = zoomByWheel(400, 300, 400, 300, s, "up")
    expect(s.zoom).toBeGreaterThan(1)
    s = zoomByWheel(400, 300, 400, 300, s, "down")
    // may still be >1 after one step
    s = zoomByWheel(400, 300, 400, 300, { zoom: 1.05, panX: 10, panY: 10 }, "down")
    expect(s.zoom).toBe(1)
    expect(s.panX).toBe(0)
    expect(s.panY).toBe(0)
  })

  test("panByCells moves pan when zoomed", () => {
    const start = { zoom: 2, panX: 0, panY: 0 }
    const next = panByCells(400, 300, 400, 300, start, 5, 0, 40, 20)
    // Drag right → pan left (negative)
    expect(next.panX).toBeLessThan(0)
  })
})
