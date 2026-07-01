import { describe, expect, test } from "bun:test"
import { initJsonRepair, repairJsonWasm } from "../../src/util/json-repair-wasm"

describe("json-repair-wasm", () => {
  test("loads json-repair wasm module", async () => {
    expect(await initJsonRepair()).toBeTrue()
  })

  test("repairs malformed object syntax", async () => {
    expect(await repairJsonWasm("{foo: 1, bar: [true,]}")).toBe('{"bar":[true],"foo":1}')
  })
})
