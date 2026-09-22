/**
 * The summary block is the handle the NEXT cycle reads. It must carry the LEGEND, never the patch
 * bodies: a block that inlines diffs replaces the intention with code churn — the measured way a
 * window's goals are lost (owner, 2026-09-21: «умник решил проза не нужна и оставил только диффы»;
 * the incident is recorded in `plans/2026-09-21_mstar-order-and-summary-restore.md`).
 *
 * Two pins, and both must be able to FAIL:
 *   1. the legend renders counts + addresses and NO `@@` / `+++` / ```diff fence — a fixture WITH
 *      patch bodies proves the bodies are dropped rather than merely absent;
 *   2. the summary range diff names its END anchor in the call — pinned by FORM (the call, not a
 *      word in a comment), the same discipline `fill-layers.test.ts` uses, because a comment
 *      survives a broken implementation and a call does not.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { buildMessageStar, diagnoseSummaryGaps, renderFileDiffLegend, renderSummaryBlock } from "../../src/session/compaction"

describe("summary block shape", () => {
  test("the legend carries counts and addresses, and drops patch bodies", () => {
    // The fixture DELIBERATELY carries bodies: if the renderer stopped filtering them, this test
    // would see `@@` where it must not.
    const diffs = [
      {
        file: "src/solver/forward.ts",
        additions: 120,
        deletions: 8,
        status: "modified",
        patch: "@@ -1,3 +1,4 @@\n--- a/src/solver/forward.ts\n+++ b/src/solver/forward.ts\n+const step = 1",
      },
      {
        file: "src/solver/inverse.ts",
        additions: 28,
        deletions: 2,
        status: "added",
        patch: "@@ -0,0 +1,3 @@\n+export const solve = () => 0",
      },
    ]

    const legend = renderFileDiffLegend(diffs, true)

    expect(legend).toContain("files=2")
    expect(legend).toContain("additions=148")
    expect(legend).toContain("deletions=10")
    expect(legend).toContain("src/solver/forward.ts (+120/-8 modified)")
    expect(legend).toContain("src/solver/inverse.ts (+28/-2 added)")
    expect(legend).toContain("sessionread")

    expect(legend.includes("@@")).toBe(false)
    expect(legend.includes("+++")).toBe(false)
    expect(legend.includes("```diff")).toBe(false)
  })

  test("the legend is capped by ADDRESSES, and the cap is named as a floor", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      file: `src/gen/file${i}.ts`,
      additions: 1,
      deletions: 0,
    }))

    const legend = renderFileDiffLegend(many, false)

    expect(legend).toContain("files=23")
    expect(legend).toContain("+3 more")
    expect(legend.includes("@@")).toBe(false)
  })

  test("FALSIFIER — the range diff names its END anchor in the call", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/session/summary.ts"), "utf8")
    const start = source.indexOf("const rangeDiffs = Effect.fn(")
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf("const enrichRange", start))
    expect(body).toContain("summaryRangeEndHash(")
    expect(body).toContain("diffFull(from, to)")
  })

  test("FALSIFIER — the patch-body dump is gone from the summary renderer", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/session/compaction.ts"), "utf8")
    // The exact shape that produced the dump: a 40-line slice of the patch inside a diff fence.
    expect(source.includes("diff.patch.trim().split(")).toBe(false)
    expect(source.includes("```diff`")).toBe(false)
  })

  test("FALSIFIER — the intention LEADS the summary block, the Exact machinery follows", () => {
    const block = renderSummaryBlock({
      sessionID: "ses_shape",
      index: 0,
      s: {
        id: "ckpt_shape",
        text: "## Goal\nRestore the summaries so the next cycle reads intention, not churn.\n",
        diffs: [
          {
            file: "src/solver/forward.ts",
            additions: 120,
            deletions: 8,
            status: "modified",
            // Carried on purpose: the block must read as intention + legend even when the entry
            // still HAS a body — otherwise the pin would only prove the body was never there.
            patch: "@@ -1,2 +1,3 @@\n--- a/src/solver/forward.ts\n+++ b/src/solver/forward.ts\n+const step = 1",
          },
        ],
      },
    })

    const goalAt = block.indexOf("## Goal")
    const legendAt = block.indexOf("files=1")
    expect(goalAt).toBeGreaterThan(-1)
    expect(legendAt).toBeGreaterThan(-1)
    // Why the window existed comes first; the system handles are still all here, just after it.
    expect(goalAt).toBeLessThan(legendAt)
    expect(block.includes("@@")).toBe(false)
  })

  test("FALSIFIER — the fading links sit at the END of memory, never above it", () => {
    const star = buildMessageStar({
      sessionID: "ses_shape",
      summaries: [{ id: "s1", text: '## Semantic Vector\ndominant: "shape pin"' }],
      recent: [],
      memory: "MEMORY-MARKER: the durable block",
      priorMessageStarId: "msg_prior_star",
    })

    const memoryAt = star.indexOf("MEMORY-MARKER: the durable block")
    const linkAt = star.indexOf("Prior message*")
    expect(memoryAt).toBeGreaterThan(-1)
    expect(linkAt).toBeGreaterThan(-1)
    // Long-term memory first (§2); a pointer to the older star may not be hoisted above it.
    expect(memoryAt).toBeLessThan(linkAt)
  })

  test("FALSIFIER — intentions WITHOUT the plan are a gapped summary", () => {
    // «Чёткие намерения с планами» (owner, 2026-09-21): the plan is a section of its own, not a
    // sentence inside Goal or Next Steps — riding inside another section is how it went missing.
    const body = (plan: string) =>
      [
        "## Semantic Vector",
        'dominant: "shape pin"',
        "",
        "## Goal",
        "Restore the summaries so the next cycle reads the intention together with the plan it served.",
        "",
        "## Plan",
        plan,
        "",
        "## Constraints & Preferences",
        "- none beyond the standing project rules",
        "",
        "## Current state",
        "### Done",
        "- the block leads with the intention",
        "### In Progress",
        "- the fold rehearsal",
        "### Blocked",
        "- nothing",
        "",
        "## Key decisions",
        "- keep the `Prior message*` label so its existing pin keeps holding",
        "",
        "## Next Steps",
        "- run the fold rehearsal",
        "",
        "## Critical Context",
        "- the star renders once per boundary and is stored as a message",
        "",
        "## Relevant Files",
        "- packages/opencode/src/session/compaction.ts: the renderer",
      ].join("\n")

    const planned = diagnoseSummaryGaps(body("1. reorder the star (compaction.ts:1377)"))
    const unplanned = diagnoseSummaryGaps(body(""))

    // Positive control: a body that CARRIES the plan must not be nagged about it.
    expect(planned.some((g) => g.startsWith("Plan "))).toBe(false)
    expect(unplanned.some((g) => g.startsWith("Plan "))).toBe(true)
  })
})
