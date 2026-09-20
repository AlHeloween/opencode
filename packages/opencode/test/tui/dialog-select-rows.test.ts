/**
 * The one-line row contract, pinned.
 *
 * The layout is the owner's (Alexander, 2026-09-20): «все в одну строчку» — every row is one
 * line, and what yields is the DESCRIPTION, never the identity and never the runtime hint.
 * The arithmetic that decides how much width the description gets is a pure function so these
 * cases fail if the contract moves, instead of a screenshot being argued about.
 */
import { describe, expect, test } from "bun:test"
import { descriptionBudget } from "../../src/cli/cmd/tui/ui/dialog-select"

const MEDIUM = 60
const LARGE = 88
const XLARGE = 116

describe("one-line rows: the description takes what is left", () => {
  test("budget is the dialog width minus the row's chrome", () => {
    // 60 − 12 chrome − 10 title − 0 footer
    expect(descriptionBudget({ title: "build_mode", rowWidth: MEDIUM })).toBe(60 - 12 - 10)
  })

  test("the runtime hint is subtracted — it never yields to the description", () => {
    const withoutHint = descriptionBudget({ title: "plan_mode", rowWidth: LARGE })
    const withHint = descriptionBudget({
      title: "plan_mode",
      footer: "huggingface/zai-org/GLM-5.3-Flash-BF16",
      rowWidth: LARGE,
    })
    expect(withHint).toBe(withoutHint - "huggingface/zai-org/GLM-5.3-Flash-BF16".length)
    // At some point a long hint simply eats the description — that is the intended order of
    // sacrifice: the runtime is what the row is FOR, the prose is what it can spare.
    expect(withHint).toBeLessThan(withoutHint)
  })

  test("a JSX footer contributes no length — only a text hint can be measured", () => {
    const asText = descriptionBudget({ title: "x", footer: "abcd", rowWidth: MEDIUM })
    const asJsx = descriptionBudget({ title: "x", footer: undefined, rowWidth: MEDIUM })
    expect(asJsx).toBeGreaterThan(asText)
  })

  test("the budget shrinks with the dialog, so a narrow form truncates first", () => {
    const medium = descriptionBudget({ title: "agent", rowWidth: MEDIUM })
    const xlarge = descriptionBudget({ title: "agent", rowWidth: XLARGE })
    expect(xlarge - medium).toBe(XLARGE - MEDIUM)
  })

  test("an absurd title or hint drives the budget non-positive, which HIDES the description", () => {
    // The renderer treats <= 4 as "no room": better no description than four characters of it.
    expect(descriptionBudget({ title: "t".repeat(200), rowWidth: MEDIUM })).toBeLessThan(0)
    expect(
      descriptionBudget({ title: "agent", footer: "f".repeat(200), rowWidth: MEDIUM }),
    ).toBeLessThan(0)
  })
})
