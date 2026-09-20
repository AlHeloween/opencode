import { describe, expect, test } from "bun:test"
import { MEMORY_TOKENS_LIMIT, memoryFlag, oldestEntryDates } from "@/memory/budget"

// Shaped after the real carrier: dated entries, in file order, with bodies under each header.
const CARRIER = [
  "## 2026-09-12 — first finding",
  "body of the first",
  "## 2026-09-18 — second finding",
  "body of the second",
  "## 2026-09-20 — third finding",
  "body of the third",
].join("\n")

describe("oldestEntryDates", () => {
  test("reads the dated headers and returns the OLDEST first", () => {
    expect(oldestEntryDates(CARRIER, 2)).toEqual(["2026-09-12", "2026-09-18"])
  })

  test("ignores every line that is not a dated header", () => {
    expect(oldestEntryDates("no entries here\n## not a date\nbody", 5)).toEqual([])
  })
})

describe("memoryFlag", () => {
  test("below the ceiling it is a NUMBER and nothing else", () => {
    const flag = memoryFlag(CARRIER, 1_000_000)
    expect(flag).toMatch(/^Memory: [\d,]+ tokens of 1,000,000 \(0\.0 %\)\.$/)
    // the control for the naming threshold: no candidates are offered while the carrier is small
    expect(flag).not.toContain("Oldest entries")
    expect(flag).not.toContain("nothing moves by itself")
  })

  test("an empty carrier reports zero rather than failing", () => {
    expect(memoryFlag("")).toBe(`Memory: 0 tokens of ${MEMORY_TOKENS_LIMIT.toLocaleString("en-US")} (0.0 %).`)
  })

  test("near the ceiling it names the oldest entries, and says who decides", () => {
    const flag = memoryFlag(CARRIER, 1)
    expect(flag).toContain("OVER the declared ceiling")
    expect(flag).toContain("Oldest entries: 2026-09-12, 2026-09-18, 2026-09-20.")
    expect(flag).toContain("nothing moves by itself")
  })

  test("a carrier with no dated entries still reports, and offers no candidates", () => {
    const flag = memoryFlag("x".repeat(200), 1)
    expect(flag).toContain("OVER the declared ceiling")
    expect(flag).not.toContain("Oldest entries")
  })
})
