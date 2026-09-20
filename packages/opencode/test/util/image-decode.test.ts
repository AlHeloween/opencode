import { expect, test } from "bun:test"
import sharp from "sharp"
import { isWebpBytes, readImage, toPngBytes } from "../../src/util/image-decode"

// A 4x3 image in both formats the app actually meets: PNG from before the WebP
// change, WebP from every attachment after it (2026-09-18).
const png = await sharp({
  create: { width: 4, height: 3, channels: 3, background: { r: 220, g: 30, b: 30 } },
})
  .png()
  .toBuffer()
const webp = await sharp(png).webp().toBuffer()

test("a WebP attachment decodes — the format every ingested image arrives in", async () => {
  expect(isWebpBytes(webp)).toBe(true)
  const img = await readImage(webp)
  expect(img.width).toBe(4)
  expect(img.height).toBe(3)
})

test("the root cause stays visible: jimp alone has no WebP codec", async () => {
  const j = (await import("jimp")) as any
  await expect(j.Jimp.read(webp)).rejects.toThrow(/webp/i)
})

test("PNG keeps the original jimp path", async () => {
  expect(isWebpBytes(png)).toBe(false)
  const img = await readImage(png)
  expect(img.width).toBe(4)
  expect(img.height).toBe(3)
})

test("toPngBytes transcodes WebP and passes other bytes through unchanged", async () => {
  const transcoded = await toPngBytes(webp)
  expect(isWebpBytes(transcoded)).toBe(false)
  expect(await toPngBytes(png)).toBe(png)
})
