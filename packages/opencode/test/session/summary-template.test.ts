import { describe, expect, test } from "bun:test"
import { diagnoseSummaryGaps, isValidSummaryBody, summaryRequestProse } from "../../src/session/compaction"

/**
 * The anchored Layer-1 template (owner ruling 2026-09-18): the compaction
 * skill's sections joined with the sidecar's Semantic Vector. This file pins the
 * template as a CONTRACT, not a suggestion — a body missing any of the eight
 * headings must be NAMED, and the four added headings must be reachable at their
 * lower floor (24 chars) without dragging the core four down.
 *
 * Why a lower floor for the additions: a 40-char floor on all eight made every
 * capture a gap-fill candidate, and before this change a gap-fill candidate
 * could lose the whole checkpoint. Continuity outranks completeness.
 */
const FULL_BODY = [
  "## Semantic Vector",
  "dominant: continuity of the agent across folds",
  "",
  "## Goal",
  "Carry the account of the work across a fold so the next window can rely on it without re-deriving.",
  "",
  "## Constraints & Preferences",
  "Diffs are attached by the system and must not be written into the prose.",
  "",
  "## Current state",
  "### Done",
  "The validator now names the anchored template's sections.",
  "### In Progress",
  "The forced gap-fill iteration is still in place.",
  "### Blocked",
  "Nothing blocked.",
  "",
  "## Key decisions",
  "- The template is a union, not a replacement: Semantic Vector stays.",
  "",
  "## Next Steps",
  "Remove the forced repair and store the body with its gaps named.",
  "",
  "## Critical Context",
  "A gapped body is still worth more than no checkpoint at all, because continuity outranks completeness.",
  "",
  "## Relevant Files",
  "packages/opencode/src/session/compaction.ts: the template and its validator live here.",
].join("\n")

const HEADINGS = [
  "## Semantic Vector",
  "## Goal",
  "## Constraints & Preferences",
  "## Current state",
  "## Key decisions",
  "## Next Steps",
  "## Critical Context",
  "## Relevant Files",
] as const

describe("anchored Layer-1 template", () => {
  test("a full anchored body is valid", () => {
    expect(diagnoseSummaryGaps(FULL_BODY)).toEqual([])
    expect(isValidSummaryBody(FULL_BODY)).toBe(true)
  })

  test("a missing ADDED heading is named, and nothing else is", () => {
    const without = FULL_BODY.replace(/## Next Steps\n[\s\S]*?(?=\n## )/, "")
    const gaps = diagnoseSummaryGaps(without)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain("Next Steps")
  })

  test("an added heading clears at 24 chars while the core four keep their floor", () => {
    const atFloor = FULL_BODY.replace(
      "Remove the forced repair and store the body with its gaps named.",
      "Remove the forced repair.",
    )
    expect(isValidSummaryBody(atFloor)).toBe(true)

    const belowFloor = FULL_BODY.replace(
      "Remove the forced repair and store the body with its gaps named.",
      "Too short.",
    )
    expect(diagnoseSummaryGaps(belowFloor).some((gap) => gap.includes("Next Steps"))).toBe(true)
  })

  test("the core four did NOT move to the lower floor", () => {
    // Guard against the cheap way to make the previous case pass: lowering every
    // minimum instead of only the four additions.
    const thinGoal = FULL_BODY.replace(
      "Carry the account of the work across a fold so the next window can rely on it without re-deriving.",
      "Carry the work forward.",
    )
    expect(diagnoseSummaryGaps(thinGoal).some((gap) => gap.includes("Goal"))).toBe(true)
  })

  test("the request carries the template AND the continuity rule", () => {
    const request = summaryRequestProse()
    for (const heading of HEADINGS) expect(request).toContain(heading)
    expect(request).toContain("Continuity rule")
    expect(request).toContain("SAME position")
    expect(request).toContain("SAME wording")
    // The old four-heading wording must be gone: it told the model that four
    // sections were the whole contract.
    expect(request).not.toContain("four headings")
  })
})
