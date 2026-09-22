/**
 * The summary block is the handle the NEXT cycle reads. It must carry the LEGEND, never the patch
 * bodies: a block that inlines diffs replaces the intention with code churn — the measured way a
 * window's goals are lost (owner, 2026-09-21: «умник решил проза не нужна и оставил только диффы»;
 * the incident is recorded in `plans/emergency/2026-09-21_mstar-order-and-summary-restore.md`).
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
import { renderFileDiffLegend } from "../../src/session/compaction"

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
})
