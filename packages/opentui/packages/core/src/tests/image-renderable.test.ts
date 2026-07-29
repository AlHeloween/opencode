import { expect, test } from "bun:test"
import { clipImageFrame, scaleRgbaNearest } from "../renderables/Image.js"

const rgba = new Uint8Array([
  1, 0, 0, 255, 2, 0, 0, 255,
  3, 0, 0, 255, 4, 0, 0, 255,
  5, 0, 0, 255, 6, 0, 0, 255,
  7, 0, 0, 255, 8, 0, 0, 255,
])

test("clipImageFrame discards an image fully above the viewport", () => {
  expect(
    clipImageFrame({
      data: rgba,
      imageWidth: 2,
      imageHeight: 4,
      layoutX: 0,
      layoutY: -4,
      layoutWidth: 2,
      layoutHeight: 4,
      viewportWidth: 4,
      viewportHeight: 2,
    }),
  ).toBeNull()
})

test("clipImageFrame crops the visible rows instead of clamping the image origin", () => {
  const frame = clipImageFrame({
    data: rgba,
    imageWidth: 2,
    imageHeight: 4,
    layoutX: 0,
    layoutY: -2,
    layoutWidth: 2,
    layoutHeight: 4,
    viewportWidth: 4,
    viewportHeight: 2,
  })

  expect(frame).toEqual({
    data: new Uint8Array([
      5, 0, 0, 255, 6, 0, 0, 255,
      7, 0, 0, 255, 8, 0, 0, 255,
    ]),
    imageWidth: 2,
    imageHeight: 2,
    x: 1,
    y: 1,
    cellWidth: 2,
    cellHeight: 2,
  })
})

test("clipImageFrame scroll-lock: moving layoutY by one cell moves stamp y by one", () => {
  const base = {
    data: rgba,
    imageWidth: 2,
    imageHeight: 4,
    layoutX: 0,
    layoutWidth: 2,
    layoutHeight: 4,
    viewportWidth: 4,
    viewportHeight: 4,
    cellPixelWidth: 10,
    cellPixelHeight: 20,
  }

  const atRow0 = clipImageFrame({ ...base, layoutY: 0 })
  const atRow1 = clipImageFrame({ ...base, layoutY: 1 })
  expect(atRow0).not.toBeNull()
  expect(atRow1).not.toBeNull()
  // 1-based terminal rows: layout 0 → y=1, layout 1 → y=2
  expect(atRow0!.y).toBe(1)
  expect(atRow1!.y).toBe(2)
  expect(atRow1!.y - atRow0!.y).toBe(1)
  // Exact slot pixels: 2 cells × 10×20
  expect(atRow0!.imageWidth).toBe(20)
  expect(atRow0!.imageHeight).toBe(80)
  expect(atRow0!.cellWidth).toBe(2)
  expect(atRow0!.cellHeight).toBe(4)
})

test("clipImageFrame scales clipped fragment to exact reserved slot pixels", () => {
  // 2×2 source into 2×2 cells with 8×16 cell pixels → stamp 16×32
  const src = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 0, 255,
  ])
  const frame = clipImageFrame({
    data: src,
    imageWidth: 2,
    imageHeight: 2,
    layoutX: 1,
    layoutY: 2,
    layoutWidth: 2,
    layoutHeight: 2,
    viewportWidth: 10,
    viewportHeight: 10,
    cellPixelWidth: 8,
    cellPixelHeight: 16,
  })
  expect(frame).not.toBeNull()
  expect(frame!.x).toBe(2) // 1-based: layoutX 1 → 2
  expect(frame!.y).toBe(3)
  expect(frame!.cellWidth).toBe(2)
  expect(frame!.cellHeight).toBe(2)
  expect(frame!.imageWidth).toBe(16)
  expect(frame!.imageHeight).toBe(32)
  // Top-left stamp pixel comes from red source
  expect(frame!.data[0]).toBe(255)
  expect(frame!.data[1]).toBe(0)
  expect(frame!.data[2]).toBe(0)
})

test("scaleRgbaNearest doubles a solid pixel", () => {
  const src = new Uint8Array([10, 20, 30, 255])
  const out = scaleRgbaNearest(src, 1, 1, 2, 2)
  expect(out.length).toBe(16)
  expect(out[0]).toBe(10)
  expect(out[4]).toBe(10)
  expect(out[8]).toBe(10)
  expect(out[12]).toBe(10)
})

test("clipImageFrame rejects non-finite layout size (NaN slot) instead of one-line stamp", () => {
  // Reproduces production log: layoutWidth/Height NaN at image mount → single line.
  expect(
    clipImageFrame({
      data: rgba,
      imageWidth: 2,
      imageHeight: 4,
      layoutX: 0,
      layoutY: 0,
      layoutWidth: Number.NaN,
      layoutHeight: Number.NaN,
      viewportWidth: 80,
      viewportHeight: 24,
      cellPixelWidth: 10,
      cellPixelHeight: 20,
    }),
  ).toBeNull()
})

test("clipImageFrame clips to ScrollBox viewport so stamp does not enter prompt/footer", () => {
  // Terminal 10 rows; ScrollBox viewport is rows 0..5 (height 6). Prompt owns rows 6..9.
  // Image slot at layoutY=4, height 4 → would cover rows 4,5,6,7 without clip.
  // With clipY=0 clipHeight=6 only rows 4..5 remain (2 cells).
  const frame = clipImageFrame({
    data: rgba,
    imageWidth: 2,
    imageHeight: 4,
    layoutX: 0,
    layoutY: 4,
    layoutWidth: 2,
    layoutHeight: 4,
    viewportWidth: 10,
    viewportHeight: 10,
    clipX: 0,
    clipY: 0,
    clipWidth: 10,
    clipHeight: 6,
    cellPixelWidth: 10,
    cellPixelHeight: 20,
  })
  expect(frame).not.toBeNull()
  expect(frame!.y).toBe(5) // 1-based: layout row 4
  expect(frame!.cellHeight).toBe(2) // only rows 4 and 5 inside viewport
  expect(frame!.imageHeight).toBe(40) // 2 cells × 20 px
  // Bottom of stamp is row 5 (0-based) → does not reach prompt at row 6
  expect(frame!.y - 1 + frame!.cellHeight).toBe(6)
})

test("clipImageFrame fully below ScrollBox viewport is discarded", () => {
  expect(
    clipImageFrame({
      data: rgba,
      imageWidth: 2,
      imageHeight: 4,
      layoutX: 0,
      layoutY: 8,
      layoutWidth: 2,
      layoutHeight: 4,
      viewportWidth: 10,
      viewportHeight: 10,
      clipX: 0,
      clipY: 0,
      clipWidth: 10,
      clipHeight: 6,
    }),
  ).toBeNull()
})
