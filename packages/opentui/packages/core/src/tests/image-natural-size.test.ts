import { expect, test } from "bun:test"
import { ImageRenderable } from "../renderables/Image.js"
import { OptimizedBuffer } from "../buffer.js"
import { createTestRenderer } from "../testing/test-renderer.js"

test("natural fit submits original pixels even when the cell box rounds up", async () => {
  const setup = await createTestRenderer({ width: 40, height: 20 })
  const renderer = setup.renderer
  ;(renderer as unknown as { _resolution: { width: number; height: number } })._resolution = { width: 480, height: 400 }
  const image = new ImageRenderable(renderer, { width: 2, height: 1, fit: "none", protocol: "sixel" })
  try {
    image.setImage(new Uint8Array(23 * 19 * 4).fill(255), 23, 19)
    await image.loadPromise
    const calls: number[][] = []
    const draw = OptimizedBuffer.prototype.drawImage
    OptimizedBuffer.prototype.drawImage = function (...args: Parameters<typeof draw>) {
      calls.push([args[5], args[6]])
      return draw.apply(this, args)
    }
    try {
      renderer.root.add(image)
      await setup.renderOnce()
      expect(calls.length).toBeGreaterThan(0)
      expect(calls).toContainEqual([23, 19])
    } finally {
      OptimizedBuffer.prototype.drawImage = draw
    }
  } finally {
    renderer.destroy()
  }
})
