import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  collectPlanState,
  criticalRisks,
  formatPlanHygiene,
  formatPlanStateText,
  getPlanStatus,
  isPlanHygieneClean,
  isPlanPlacementClean,
  planDebt,
} from "../../src/util/plan-status"

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

  test("canon files beside the plans are not plans — their FORMAT EXAMPLES are not state", () => {
    // Measured 2026-09-22: `plans/README.md` printed as an ACTIVE plan because its prose shows the
    // checkbox format (`- [ ] Smoke requirements written`), and the reconciler would have moved the
    // canon file itself into plans_completed/ once those examples were ticked. Examples are data for a
    // parser only if the parser is told they are not.
    const dir = fixture({
      "2026-01-03_live.md": "# Live\n\n- [ ] real work\n",
      "README.md": "# Canon\n\n- [ ] Smoke requirements written\n- [ ] Baseline recorded [Exact]\n",
    })
    const status = getPlanStatus(dir)
    expect(status.active).toEqual(["2026-01-03_live.md"])
    // And the debt count follows the same filter: one open box, not three.
    expect(planDebt(dir)).toEqual({ plans: 1, open: 1 })
  })

  test("the hygiene line reports PLACEMENT and BACKLOG as two facts, not one gate", () => {
    // The line used to fire on `!isPlanHygieneClean`, so a live backlog printed «next work MUST fix
    // checkboxes / file locations before new features» — the defect that made the orchestrator
    // unusable. Falsifier: a placement-clean worktree with open work must NOT read as placement debt,
    // and must still name the backlog.
    const live = getPlanStatus(fixture({ "2026-01-04_live.md": "# Live\n\n- [ ] real work\n" }))
    const liveLine = formatPlanHygiene(live)
    expect(liveLine).not.toContain("PLACEMENT DEBT")
    expect(liveLine).toContain("Backlog: 1 plan(s) with open boxes")

    const misplaced = getPlanStatus(
      fixture({ "2026-01-05_done.md": "# Done\n\n- [x] one\n" }),
    )
    const misplacedLine = formatPlanHygiene(misplaced)
    expect(misplacedLine).toContain("PLACEMENT DEBT")
    expect(misplacedLine).not.toContain("Backlog:")
  })

  test("criticalRisks — @LOOP_MEASURE's third axis, read from the plans, open ones only", () => {
    // The axis that had NO carrier at all: `owed` reads open boxes and `unstamped_claims` reads its
    // durable row, but `critical_risks` was carried nowhere — and `CLOSURE_PROOF` turns on
    // `critical_risks: 0`, so a field that is never written reads as a clear field. The carrier is the
    // plan file that already says where the risk sits (`## Risks`); the marker is a tag in a comment,
    // the same habit the task lines use. A finished plan's risks are history, not debt — hence
    // open-plans-only, which is the falsifier this test carries: the SAME risk in a closed plan
    // must not be counted.
    const risks = criticalRisks(
      fixture({
        "2026-01-06_open.md":
          "# Open\n\n- [ ] work\n\n## Risks\n\n- prefix counter would miss every turn <!-- severity: critical -->\n- slow path, bounded <!-- severity: low -->\n",
        "2026-01-07_done.md":
          "# Done\n\n- [x] one\n\n## Risks\n\n- was critical, shipped <!-- severity: critical -->\n",
      }),
    )
    expect(risks).toEqual({ plans: ["plans/2026-01-06_open.md"], count: 1 })
  })
})
