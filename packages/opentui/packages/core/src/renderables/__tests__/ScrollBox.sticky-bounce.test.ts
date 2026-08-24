import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../../testing.js"
import type { MockMouse } from "../../testing/test-renderer.js"
import { ScrollBoxRenderable } from "../ScrollBox.js"
import { TextRenderable } from "../Text.js"
import { BoxRenderable } from "../Box.js"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let mouse: MockMouse
let root: BoxRenderable

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 50, height: 12 })
  currentRenderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  mouse = testRenderer.mockMouse
  root = new BoxRenderable(currentRenderer, { id: "root", width: 50, height: 12 })
  currentRenderer.root.add(root)
})

afterEach(async () => {
  if (currentRenderer) {
    currentRenderer.destroy()
  }
})

function buildTranscript(rows: number): ScrollBoxRenderable {
  const box = new ScrollBoxRenderable(currentRenderer, {
    id: "transcript",
    width: 50,
    height: 12,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
  })
  for (let i = 0; i < rows; i++) {
    box.add(new TextRenderable(currentRenderer, { id: `row-${i}`, text: `row ${i}` }))
  }
  root.add(box)
  return box
}

describe("ScrollBox sticky transcript - wheel bounce repro", () => {
  test("wheel down returns to bottom after wheel up (no bounce)", async () => {
    const box = buildTranscript(50)
    await renderOnce()
    const max = () => Math.max(0, box.scrollHeight - box.height)

    // Sticky start: pinned to bottom.
    expect(box.scrollTop).toBe(max())

    // Wheel up 3 notches.
    await mouse.scroll(5, 5, "up")
    await mouse.scroll(5, 5, "up")
    await mouse.scroll(5, 5, "up")
    await renderOnce()
    const afterUp = box.scrollTop
    expect(afterUp).toBeLessThan(max())

    // Streaming: content grows while user is reading above the bottom.
    for (let i = 50; i < 55; i++) {
      box.add(new TextRenderable(currentRenderer, { id: `row-${i}`, text: `row ${i}` }))
    }
    await renderOnce()
    // Manual scroll must be preserved - no snap to bottom, no upward drift.
    expect(box.scrollTop).toBe(afterUp)

    // Wheel down plenty of notches - must reach the bottom exactly.
    for (let i = 0; i < 20; i++) {
      await mouse.scroll(5, 5, "down")
    }
    await renderOnce()
    expect(box.scrollTop).toBe(max())
  })

  test("repeated wheel down near bottom converges to bottom (no oscillation)", async () => {
    const box = buildTranscript(50)
    await renderOnce()
    const max = () => Math.max(0, box.scrollHeight - box.height)

    // Jump mid-list like a user who scrolled up earlier.
    box.scrollTop = Math.floor(max() / 2)
    await renderOnce()

    // Steady wheel down - positions must be monotonic and settle at max.
    const seen: number[] = []
    for (let i = 0; i < 30; i++) {
      await mouse.scroll(5, 5, "down")
      await renderOnce()
      seen.push(box.scrollTop)
    }
    expect(seen[seen.length - 1]).toBe(max())
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    }
  })
})
