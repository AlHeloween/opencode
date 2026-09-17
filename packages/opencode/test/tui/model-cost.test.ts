import { describe, expect, test } from "bun:test"
import {
  cacheLabel,
  capabilityGlyphs,
  compactCostLabel,
  costLabel,
  formatCost,
  isFreeModel,
} from "../../src/cli/cmd/tui/component/model-cost"

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

describe("compact model footer", () => {
  // The picker's prose footer was 78 chars — wider than the usable row at every
  // dialog size — so it squeezed the model NAME down to three characters
  // ("Z.a", "Dee") and butted it against the price. The status line already had
  // a compact encoding; it just lived inline in the prompt component.
  test("the compact form is far shorter than the prose one", () => {
    const cost = { input: 0.09, output: 0.3, cache: { read: 0.018 } }
    const compact = [compactCostLabel(cost), capabilityGlyphs({ reasoning: true, toolcall: true, input: { image: true } })]
      .filter(Boolean)
      .join(" ")
    const prose = [costLabel(cost), cacheLabel(cost), "reasoning · tools · vision"].filter(Boolean).join(" · ")
    expect(compact.length).toBeLessThan(prose.length / 1.5)
  })

  test("glyph price reads input, output and cache", () => {
    expect(compactCostLabel({ input: 0.09, output: 0.3, cache: { read: 0.018 } })).toBe("⇣0.09 ⇡0.3 ↻0.018")
  })

  test("cache read and write are summed into one chip", () => {
    expect(compactCostLabel({ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } })).toBe("⇣1 ⇡2 ↻0.3")
  })

  test("an unpublished price shows nothing, never a zero", () => {
    // Hugging Face publishes no price; the status line rendered "⇣0 ⇡0 ↻0",
    // showing absence of data as a claim that the model is free.
    expect(compactCostLabel({ input: 0, output: 0 })).toBeUndefined()
    expect(compactCostLabel(undefined)).toBeUndefined()
    expect(compactCostLabel({})).toBeUndefined()
  })

  test("a zero side is omitted while a published side still shows", () => {
    expect(compactCostLabel({ input: 0, output: 0.6 })).toBe("⇡0.6")
    expect(compactCostLabel({ input: 0.15, output: 0.6, cache: { read: 0 } })).toBe("⇣0.15 ⇡0.6")
  })

  test("capability glyphs keep the status line's order", () => {
    expect(capabilityGlyphs({ reasoning: true, toolcall: true, input: { image: true, video: true } })).toBe(
      "[🎥 👁 🧠 🔧]",
    )
    expect(capabilityGlyphs({ toolcall: true })).toBe("[🔧]")
    expect(capabilityGlyphs({})).toBeUndefined()
    expect(capabilityGlyphs(undefined)).toBeUndefined()
  })
})
