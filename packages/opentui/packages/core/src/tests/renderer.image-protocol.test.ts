import { expect, test } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer.js"

test("explicit image protocol updates native graphics capabilities", async () => {
  const { renderer } = await createTestRenderer({})

  expect(renderer.setImageProtocol("sixel")).toBe(true)
  expect(renderer.capabilities?.sixel).toBe(true)
  expect(renderer.capabilities?.kitty_graphics).toBe(false)

  expect(renderer.setImageProtocol("symbols")).toBe(true)
  expect(renderer.capabilities?.sixel).toBe(false)
  expect(renderer.capabilities?.kitty_graphics).toBe(false)

  renderer.destroy()
})

test("remote renderers reject graphics protocol overrides", async () => {
  const { renderer } = await createTestRenderer({ remote: true })

  expect(renderer.setImageProtocol("sixel")).toBe(false)
  expect(renderer.capabilities?.sixel).toBeFalsy()

  renderer.destroy()
})
