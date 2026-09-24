// T10 of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md — `setImage` must not leak the caller's
// NativeImage reference.
//
// The renderable RETAINS a supplied NativeImage, so "the caller still owns and must dispose its source
// reference" (.opencode/skills/opentui/references/components/text-display.md:305-306). `setImage` is the
// caller here: it builds the NativeImage itself (Image.ts), so it is the one that must release it. The
// predicate reads the observable half of ownership — `dispose()` nulls the wrapper's handle
// (image.ts:646-650) — and the control half keeps it honest: the renderable must still show a live image.

import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { NativeImage } from "../image.js"
import { ImageRenderable } from "../renderables/Image.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

setDefaultTimeout(20_000)

let renderer: TestRenderer | undefined

afterEach(() => {
  renderer?.destroy()
  renderer = undefined
})

test("setImage releases the caller's reference once the renderable has retained its own (T10)", async () => {
  const setup = await createTestRenderer({ width: 20, height: 10 })
  renderer = setup.renderer
  const pixels = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255)

  // Pass-through observation: every wrapper `setImage` creates is recorded, nothing is replaced.
  const created: NativeImage[] = []
  const fromRgba = NativeImage.fromRgba
  NativeImage.fromRgba = (...args: Parameters<typeof fromRgba>) => {
    const image = fromRgba.apply(NativeImage, args)
    created.push(image)
    return image
  }

  try {
    const image = new ImageRenderable(setup.renderer, { width: 4, height: 2 })
    setup.renderer.root.add(image)
    for (let i = 0; i < 3; i++) {
      image.setImage(pixels, 2, 2)
      await image.loadPromise
      await setup.renderOnce()
    }

    expect(created.length).toBe(3)
    // Ownership: every reference `setImage` created for itself has been released...
    expect(created.map((item) => (item as unknown as { handle: unknown }).handle)).toEqual([null, null, null])
    // ...and the renderable still holds a live image of its own (the retained copy).
    expect(image.image).not.toBeNull()
    expect(image.image!.width).toBe(2)
    expect(image.image!.height).toBe(2)
  } finally {
    NativeImage.fromRgba = fromRgba
  }
})
