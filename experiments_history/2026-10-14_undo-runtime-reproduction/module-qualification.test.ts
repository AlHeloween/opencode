import { expect, test } from "bun:test"

test("experimental TUI resolves the product source aliases", async () => {
  expect(Bun.resolveSync("@opentui/solid", import.meta.dir).replaceAll("\\", "/")).toContain("packages/opentui/packages/solid")
  const { qualifyRenderer } = await import("./dialog-replay")
  await qualifyRenderer()
})
