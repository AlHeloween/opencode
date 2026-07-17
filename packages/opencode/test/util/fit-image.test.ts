import { describe, expect, test } from "bun:test"
import { fitContainSize, parseSvgNaturalSize } from "../../src/util/fit-image"

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
