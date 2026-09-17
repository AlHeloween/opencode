import { describe, expect, test } from "bun:test"
import { isTwoLineRow } from "../../src/cli/cmd/tui/ui/dialog-select"
import { capabilityGlyphs, compactCostLabel } from "../../src/cli/cmd/tui/component/model-cost"

describe("dialog row line count", () => {
  // `rows()` used to assume one line per option while the renderer split long
  // rows onto two, so the scrollbox height — and every scroll computation
  // derived from it — was short by the number of split rows. Both now call this
  // one predicate, so they cannot disagree again.

  const MEDIUM = 60
  const LARGE = 88

  test("a row with no description is always one line", () => {
    expect(
      isTwoLineRow({ title: "x".repeat(200), description: undefined, footer: "y".repeat(200), rowWidth: MEDIUM }),
    ).toBe(false)
  })

  test("a short row stays inline", () => {
    expect(isTwoLineRow({ title: "GPT-5", description: "OpenAI", footer: "⇣1 ⇡2", rowWidth: LARGE })).toBe(false)
  })

  test("a row that cannot fit inline splits", () => {
    expect(
      isTwoLineRow({
        title: "DeepSeek V4.1 Flash Thinking",
        description: "OpenRouter",
        footer: "$0.09→$0.3/1M · cache $0.018 · reasoning · tools · vision · 1.3M ctx · variants",
        rowWidth: LARGE,
      }),
    ).toBe(true)
  })

  test("a non-string footer is costed, not treated as free", () => {
    // JSX footers have no measurable length here; the predicate reserves a
    // nominal width rather than pretending they take none.
    const withJsx = isTwoLineRow({
      title: "x".repeat(70),
      description: "OpenRouter",
      footer: undefined,
      rowWidth: LARGE,
    })
    expect(withJsx).toBe(true)
  })
})

describe("the compact footer buys back the model name", () => {
  // The defect, stated as a measurement: at width 88 the usable row is 76
  // columns, and the prose footer alone was 78 — so the title was squeezed to
  // three characters ("Z.a", "Dee") with no gap before the price.
  const USABLE = 88 - 12

  const cost = { input: 0.09, output: 0.3, cache: { read: 0.018 } }
  const capabilities = { reasoning: true, toolcall: true, input: { image: true } }

  const prose = "$0.09→$0.3/1M · cache $0.018 · reasoning · tools · vision · 1.3M ctx · variants"
  const compact = [compactCostLabel(cost), capabilityGlyphs(capabilities), "1.3M"].filter(Boolean).join(" ")

  test("the prose footer alone overflowed the usable row", () => {
    expect(prose.length).toBeGreaterThan(USABLE)
  })

  test("the compact footer leaves room for a readable name", () => {
    expect(USABLE - compact.length).toBeGreaterThanOrEqual(24)
  })

  test("a realistic row now fits inline instead of splitting", () => {
    expect(isTwoLineRow({ title: "DeepSeek V4.1 Flash", description: "DeepSeek", footer: compact, rowWidth: 88 })).toBe(
      false,
    )
  })
})
