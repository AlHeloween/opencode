import { expect, test } from "bun:test"
import { clipImageFrame } from "../renderables/Image.js"

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
