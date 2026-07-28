import { expect, test } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer.js"

test("explicit image protocol updates native graphics capabilities", async () => {
  const { renderer } = await createTestRenderer({})

  renderer.setImageProtocol("sixel")
  expect(renderer.capabilities?.sixel).toBe(true)
  expect(renderer.capabilities?.kitty_graphics).toBe(false)

  renderer.setImageProtocol("symbols")
  expect(renderer.capabilities?.sixel).toBe(false)
  expect(renderer.capabilities?.kitty_graphics).toBe(false)

  renderer.destroy()
})
