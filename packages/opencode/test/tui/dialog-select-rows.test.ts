/**
 * The one-line row contract, pinned.
 *
 * The layout is the owner's (Alexander, 2026-09-20): «все в одну строчку» — every row is one
 * line; what yields is the DESCRIPTION, never the identity and never the runtime.
 *
 * And the columns are a property of the LIST, not of a row: a per-row width (what this file
 * used to pin) elided each description to its own neighbours, so every runtime started at its
 * own x — the ragged right column reported twice (Alexander: «Теперь посмотри на
 * форматирование» / «ну реальная чушь»). These cases fail if the arithmetic ever goes back to
 * being per-row, because then one list would produce more than one description width.
 */
import { describe, expect, test } from "bun:test"
import { rowColumns } from "../../src/cli/cmd/tui/ui/dialog-select"

const MEDIUM = 60
const LARGE = 88
const XLARGE = 116
/** The exact footer measured on /agents (48 characters). */
const AGENT_FOOTER = "huggingface/zai-org/GLM-5.3-Flash-BF16 · task: 2"

describe("one-line rows: three fixed columns", () => {
  test("a short name still gets the floor, so the columns do not move with the name", () => {
    const columns = rowColumns({
      titles: ["build_mode"],
      descriptions: ["Primary implementer."],
      footers: [],
      rowWidth: MEDIUM,
    })
    expect(columns.title).toBe(24)
    expect(columns.footer).toBe(0)
    expect(columns.description).toBe(MEDIUM - 10 - 24)
  })

  test("a title longer than the cap elides inside its column instead of eating the row", () => {
    const columns = rowColumns({
      titles: ["x".repeat(40)],
      descriptions: ["a description is present"],
      footers: [],
      rowWidth: XLARGE,
    })
    expect(columns.title).toBe(28)
    expect(columns.description).toBe(XLARGE - 10 - 28)
  })

  test("with NO description anywhere the cap does not apply — the name is the whole row", () => {
    // The file picker's case: a 60-character path must not be elided at 28 because a cap meant
    // to protect a description column that does not exist here.
    const title = "x".repeat(60)
    const columns = rowColumns({ titles: [title], descriptions: [undefined], footers: [], rowWidth: XLARGE })
    // The column is its own content's width — 60, not the 28 the cap would give it, and not the
    // remaining dialog either (a column wider than its content is a column of empty cells).
    expect(columns.title).toBe(60)
    expect(columns.description).toBe(XLARGE - 10 - 60)
    // …but a runtime still holds its own column even then.
    const withFooter = rowColumns({
      titles: [title],
      descriptions: [undefined],
      footers: [AGENT_FOOTER],
      rowWidth: XLARGE,
    })
    expect(withFooter.footer).toBe(AGENT_FOOTER.length)
    expect(withFooter.title).toBe(XLARGE - 10 - AGENT_FOOTER.length)
  })

  test("the WIDEST runtime sets the column for every row — that is what makes it a column", () => {
    const columns = rowColumns({
      titles: ["a"],
      descriptions: ["d"],
      footers: [AGENT_FOOTER, "task: 1"],
      rowWidth: XLARGE,
    })
    expect(columns.footer).toBe(AGENT_FOOTER.length)
    // Not "the longest one for its own row": one width, used by the row with the short runtime
    // too, which is where the slack now lives.
    expect(columns.description).toBe(XLARGE - 10 - 24 - AGENT_FOOTER.length)
  })

  test("the columns do not depend on WHICH row carries the maxima", () => {
    // Same list, the long name and the long runtime swapped between rows: a per-row budget
    // would give two different answers here, a column grid gives one.
    const together = rowColumns({
      titles: ["orchestrator_agent", "plan_mode"],
      descriptions: ["d", "d"],
      footers: [AGENT_FOOTER, "task: 1"],
      rowWidth: XLARGE,
    })
    const apart = rowColumns({
      titles: ["orchestrator_agent", "plan_mode"],
      descriptions: ["d", "d"],
      footers: ["task: 1", AGENT_FOOTER],
      rowWidth: XLARGE,
    })
    expect(together).toEqual(apart)
  })

  test("an absurd runtime is capped, so one row cannot starve the description", () => {
    const columns = rowColumns({
      titles: ["agent"],
      descriptions: ["d"],
      footers: ["f".repeat(200)],
      rowWidth: XLARGE,
    })
    expect(columns.footer).toBe(48)
    expect(columns.description).toBeGreaterThan(20)
  })

  test("a narrow dialog drives the description to zero, and never below it", () => {
    const columns = rowColumns({
      titles: ["averyveryverylongagentname"],
      descriptions: ["d"],
      footers: [AGENT_FOOTER],
      rowWidth: MEDIUM,
    })
    // 60 − 10 chrome − 28 (the capped title) − 48 (the runtime) is NEGATIVE, so the description
    // is dropped rather than given a negative width.
    expect(MEDIUM - 10 - 28 - AGENT_FOOTER.length).toBeLessThan(0)
    expect(columns.description).toBe(0)
  })

  test("the empty list still yields a printable grid", () => {
    const columns = rowColumns({ titles: [], descriptions: [], footers: [], rowWidth: LARGE })
    expect(columns).toEqual({ title: 24, description: LARGE - 10 - 24, footer: 0 })
  })
})
