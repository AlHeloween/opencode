import { describe, expect, test } from "bun:test"
import { cacheLabel, costLabel, formatCost, isFreeModel } from "../../src/cli/cmd/tui/component/model-cost"

describe("model cost footer", () => {
  test("keeps the cheap end readable without padding the expensive end", () => {
    expect(formatCost(0.003)).toBe("0.003")
    expect(formatCost(0.0036)).toBe("0.0036")
    expect(formatCost(0.15)).toBe("0.15")
    expect(formatCost(0.6)).toBe("0.6")
    expect(formatCost(1.5)).toBe("1.5")
    expect(formatCost(15)).toBe("15")
    expect(formatCost(75)).toBe("75")
  })

  test("renders input to output per million", () => {
    expect(costLabel({ input: 0.15, output: 0.6 })).toBe("$0.15→$0.6/1M")
    expect(costLabel({ input: 0.435, output: 0.87 })).toBe("$0.435→$0.87/1M")
  })

  test("an unpublished price shows nothing rather than claiming zero", () => {
    // Provider.cost() normalises a missing price to {input:0,output:0}, so the
    // bundled StreamLake catalogue (vanchin() sets no cost) would otherwise
    // render as free.
    expect(costLabel({ input: 0, output: 0 })).toBeUndefined()
    expect(costLabel(undefined)).toBeUndefined()
    expect(costLabel({})).toBeUndefined()
    // One published side is still a price worth showing.
    expect(costLabel({ input: 0, output: 0.6 })).toBe("$0→$0.6/1M")
  })

  test("free is claimed only for the provider that publishes real zeros", () => {
    expect(isFreeModel({ input: 0, output: 0 }, "opencode")).toBe(true)
    expect(isFreeModel({ input: 0, output: 0 }, "streamlake-vanchin")).toBe(false)
    expect(isFreeModel({ input: 0.15, output: 0.6 }, "opencode")).toBe(false)
    expect(isFreeModel(undefined, "opencode")).toBe(true)
  })
  test("the cache chip appears only where a read price is published", () => {
    // For an agent loop this is often the decisive number: deepseek-flash
    // reads cache at $0.003 against $0.15 fresh input.
    expect(cacheLabel({ input: 0.15, output: 0.6, cache: { read: 0.003 } })).toBe("cache $0.003")
    expect(cacheLabel({ input: 0.15, output: 0.6, cache: { read: 0 } })).toBeUndefined()
    expect(cacheLabel({ input: 0.15, output: 0.6 })).toBeUndefined()
    expect(cacheLabel(undefined)).toBeUndefined()
    // Write price alone is not a read price.
    expect(cacheLabel({ cache: { write: 0.2 } })).toBeUndefined()
  })
})
