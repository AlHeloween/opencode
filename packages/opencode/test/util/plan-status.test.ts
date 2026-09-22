import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { collectPlanState, formatPlanStateText, getPlanStatus, isPlanHygieneClean, isPlanPlacementClean } from "../../src/util/plan-status"

function worktreeWith(plan: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-state-"))
  mkdirSync(path.join(dir, "plans"), { recursive: true })
  writeFileSync(path.join(dir, "plans", "2026-09-12_probe.md"), plan)
  return dir
}

describe("util.plan-status intention", () => {
  test("carries the kernel intention into the plan state mirror", () => {
    const payload = collectPlanState(
      worktreeWith(
        "# probe\n\n<!-- workflow: lifecycle EXECUTING | gate G7 -->\n" +
          "<!-- intention: TUI hangs when the log dir is full -> TUI starts clean with 100+ logs -->\n" +
          "<!-- goal_sv: tui, startup -->\n",
      ),
    )

    expect(payload.plans[0].intention).toEqual({
      from_state: "TUI hangs when the log dir is full",
      to_state: "TUI starts clean with 100+ logs",
    })
    expect(formatPlanStateText(payload)).toContain(
      "intention: TUI hangs when the log dir is full -> TUI starts clean with 100+ logs",
    )
  })

  test("a marker without the arrow yields no intention", () => {
    const payload = collectPlanState(
      worktreeWith("# probe\n\n<!-- workflow: lifecycle EXECUTING -->\n<!-- intention: make it good -->\n"),
    )

    expect(payload.plans[0].intention).toBeUndefined()
    expect(formatPlanStateText(payload)).not.toContain("intention:")
  })
})

/**
 * ONE PREDICATE, ONE AXIS — the split that made the orchestrator usable.
 *
 * `isPlanHygieneClean` answers two questions at once: is there open work (`active`) and is every file in
 * its terminal (`misplaced`). The AGI loop used the conjunction where it meant placement alone, so with
 * any live plan it told the orchestrator «next directive MUST fix plans/plans_completed before new
 * features» — a backlog read as a hygiene defect (owner, 2026-09-22: «сейчас невозможно использовать
 * оркестратор из-за этого»). The falsifier is the state that must read one way and not the other.
 */
describe("util.plan-status hygiene axes", () => {
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "plan-axis-"))
    mkdirSync(path.join(dir, "plans"), { recursive: true })
    mkdirSync(path.join(dir, "plans_completed"), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "plans", name), body)
    return dir
  }

  test("a live backlog is placement-CLEAN and hygiene-dirty — the distinction the loop now makes", () => {
    const status = getPlanStatus(fixture({ "2026-01-01_live.md": "# Live\n\n- [ ] real work\n" }))
    expect(status.active).toEqual(["2026-01-01_live.md"])
    // Placement is perfect: every file is in its terminal. The hygiene question is answered YES here.
    expect(isPlanPlacementClean(status)).toBe(true)
    // The conjunction answers NO — and that is the answer the loop used to act on, blocking dispatch.
    expect(isPlanHygieneClean(status)).toBe(false)
  })

  test("and the OTHER axis: a misplaced file is hygiene-dirty even with no open work at all", () => {
    const status = getPlanStatus(fixture({ "2026-01-02_done.md": "# Done\n\n- [x] one\n" }))
    expect(status.active).toEqual([])
    expect(isPlanPlacementClean(status)).toBe(false)
    expect(status.misplaced.some((f) => f.includes("2026-01-02_done.md"))).toBe(true)
  })
})
