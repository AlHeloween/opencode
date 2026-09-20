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
  test("budget is the dialog width minus the row's chrome, and the title floor counts", () => {
    // 60 − 12 chrome − 24 FLOOR (not "build_mode".length = 10) − 0 footer
    expect(descriptionBudget({ title: "build_mode", rowWidth: MEDIUM })).toBe(60 - 12 - 24)
    // A long title past the floor pays for its own length instead.
    const long = "x".repeat(40)
    expect(descriptionBudget({ title: long, rowWidth: MEDIUM })).toBe(60 - 12 - 40)
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

  test("the /agents case that was NONSENSE on screen now elides with room to spare", () => {
    // The exact row measured 2026-09-20: title, a long model hint, and a sentence that was
    // clipped mid-word and butted into the hint. The budget must leave the hint intact and
    // still give the description a usable run.
    const footer = "huggingface/zai-org/GLM-5.3-Flash-BF16 · task: 2"
    const budget = descriptionBudget({ title: "orchestrator_agent", footer, rowWidth: XLARGE })
    expect(budget).toBeGreaterThan(20)
    // The title floor (24) is what the layout reserves, not the 18 characters of the name —
    // the same correction that made the on-screen row overflow.
    expect(budget).toBe(XLARGE - 12 - 24 - footer.length)
  })

  test("an absurd title or hint drives the budget non-positive, which HIDES the description", () => {
    // The renderer treats <= 4 as "no room": better no description than four characters of it.
    expect(descriptionBudget({ title: "t".repeat(200), rowWidth: MEDIUM })).toBeLessThan(0)
    expect(
      descriptionBudget({ title: "agent", footer: "f".repeat(200), rowWidth: MEDIUM }),
    ).toBeLessThan(0)
  })
})
