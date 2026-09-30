import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  collectPlanState,
  criticalRisks,
  formatPlanHygiene,
  formatPlanStateText,
  getPlanStatus,
  hasChecklist,
  isPlanHygieneClean,
  isPlanPlacementClean,
  masterPlanCoverage,
  planDebt,
  reconcilePlans,
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
 * P1/P2 of `plans/2026-09-30_plan-parser-silent-sv-loss.md` — a tag the author wrote is READ, and an id
 * the author wrote SURVIVES.
 *
 * Both defects were SILENT, which is why they lasted. A box with no bold id was handed
 * `parseTaskTags("")`, so its `<!-- sv: … -->` was never looked at — that is how a `svm set` can be
 * written and never found again. And an id containing a hyphen was cut at the hyphen (`TASK-6` -> `TASK`),
 * so every `TASK-N` box in one plan collapsed onto a single name and two boxes could claim one identity.
 * The positional fallback hides the second one: it prints `TASK-6` for the SIXTH box whatever the author
 * wrote, which reads correct until the order moves.
 */
describe("util.plan-status box parsing", () => {
  const tasksOf = (boxes: string) =>
    collectPlanState(worktreeWith(`# probe\n\n## Work\n\n${boxes}\n`)).plans[0]!.tasks

  test("a tag on a box with no bold id is read, not dropped", () => {
    const [task] = tasksOf("- [ ] plain box, no id at all <!-- sv: alpha, beta -->")
    expect(task!.sv).toEqual(["alpha", "beta"])
  })

  test("the same box's bookkeeping fields are read too", () => {
    const [task] = tasksOf(
      "- [ ] plain <!-- sv: alpha | done_pct: 40 | attempts: 2 | last_failure: it broke here -->",
    )
    expect(task!.sv).toEqual(["alpha"])
    expect(task!.done_pct).toBe(40)
    expect(task!.attempts).toBe(2)
    expect(task!.last_failure).toBe("it broke here")
  })

  test("an id containing a hyphen survives the reader", () => {
    const [task] = tasksOf("- [ ] **S-A static inventory:** six boxes collapsed to one id")
    expect(task!.id).toBe("S-A")
  })

  test("a hyphenated id and its title separate at the first space", () => {
    const [task] = tasksOf("- [ ] **TASK-6 (a) agent glyph and (b) protocol glyph — still open.**")
    expect(task!.id).toBe("TASK-6")
    expect(task!.title).toBe("(a) agent glyph and (b) protocol glyph — still open.")
  })

  test("an em-dash separator still separates id from title", () => {
    const [task] = tasksOf("- [ ] **R2 — the timing is STATE, keyed by the turn.**")
    expect(task!.id).toBe("R2")
    expect(task!.title).toBe("the timing is STATE, keyed by the turn.")
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

  test("a plan with NO checklist is NOT complete — its state is unknown, and nothing moves it", () => {
    // Measured 2026-09-22: 18 of the 20 files the report called `misplaced` state no checklist at
    // all. `hasOpenItems` answers «is anything open», which a file with no items answers FALSE — so a
    // prose plan read as COMPLETE and `reconcilePlans` would have moved it into plans_completed/,
    // declaring work done that is not. The falsifier is the MOVE itself: only the ticked file may go.
    const dir = fixture({
      "2026-01-08_prose.md": "# Prose\n\nThe work is described here and nowhere ticked.\n",
      "2026-01-09_done.md": "# Done\n\n- [x] one\n",
    })
    const status = getPlanStatus(dir)
    expect(status.misplaced).toEqual(["plans/2026-01-09_done.md"])
    expect(status.noChecklist).toEqual(["plans/2026-01-08_prose.md"])
    const moved = reconcilePlans(dir)
    expect(moved.movedToCompleted).toEqual(["2026-01-09_done.md"])
    expect(existsSync(path.join(dir, "plans", "2026-01-08_prose.md"))).toBe(true)
  })

  test("hasChecklist reads all three item forms — a box-less file is the only false", () => {
    const dir = fixture({
      "2026-01-10_open.md": "# A\n\n- [ ] a\n",
      "2026-01-11_done.md": "# B\n\n- [x] b\n",
      "2026-01-12_partial.md": "# C\n\n- [~] c\n",
      "2026-01-13_none.md": "# D\n\nno items here\n",
    })
    const p = (f: string) => path.join(dir, "plans", f)
    expect(hasChecklist(p("2026-01-10_open.md"))).toBe(true)
    expect(hasChecklist(p("2026-01-11_done.md"))).toBe(true)
    expect(hasChecklist(p("2026-01-12_partial.md"))).toBe(true)
    expect(hasChecklist(p("2026-01-13_none.md"))).toBe(false)
  })

  test("the lifecycle is read from FOUR forms — a reader that knows one declares the rest UNKNOWN", () => {
    // Measured 2026-09-22: thirteen plans under `plans/` state no checklist and EVERY one rendered as
    // `lifecycle UNKNOWN`, while several of them write their state outright — `**Status:** ACTIVE`,
    // «Статус: **DRAFT**» (mid-line, after a date), `state: DRAFT`. The reader knew only a bold English
    // `**Status:**` at the start of a line, so the state was written and unreadable: the coupling
    // watcher's `8×4`/`16+16` defect one layer over. The falsifier has two halves — each form must
    // ARRIVE, and the silent file must NOT be given a state it never wrote.
    const dir = fixture({
      "2026-01-20_bold-en.md": "# A\n\n**Status:** ACTIVE (2026-09-21) — impl landed\n",
      "2026-01-21_bold-ru.md": "# B\n\nДата: 2026-09-21. Статус: **DRAFT**.\n",
      "2026-01-22_yaml.md": "# C\n\nstate: DRAFT\nscope: src\n",
      "2026-01-23_silent.md": "# D\n\nThe work is described here and nowhere stated.\n",
    })
    const status = getPlanStatus(dir)
    const stated = Object.fromEntries(status.noChecklistStated.map((p) => [p.file, p.lifecycle]))
    expect(stated["plans/2026-01-20_bold-en.md"]).toBe("ACTIVE")
    expect(stated["plans/2026-01-21_bold-ru.md"]).toBe("DRAFT")
    expect(stated["plans/2026-01-22_yaml.md"]).toBe("DRAFT")
    expect(stated["plans/2026-01-23_silent.md"]).toBeUndefined()
    expect(status.noChecklist.length).toBe(4)
    // And the report names WHICH is which: one UNKNOWN count for all four is what hid the reader's
    // own defect behind a plausible number.
    const line = formatPlanHygiene(status)
    expect(line).toContain("3 write their own state")
    expect(line).toContain("1 state nothing")
    expect(line).toContain("plans/2026-01-21_bold-ru.md DRAFT")
  })
})

/**
 * THE MAP'S COVERAGE — the owner's reciprocal check (2026-09-30): «или сделать проверку что все планы в
 * планах входят в мастер план». Its first outside reader (an agent that had never seen this session) asked
 * for it before anything else: «почему не все планы в мастер плане». A plan under `plans/` that the master
 * plan does not name is not read and not deleted — it simply stops being anyone's work, and no other line in
 * this file can report it.
 */
describe("util.plan-status master plan coverage", () => {
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "plan-master-"))
    mkdirSync(path.join(dir, "plans"), { recursive: true })
    mkdirSync(path.join(dir, "plans_completed"), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "plans", name), body)
    return dir
  }

  test("a plan the master plan does not name is REPORTED, and a named one is not", () => {
    const dir = fixture({
      "2026-01-01_named.md": "# Named\n\n- [ ] work\n",
      "2026-01-02_orphan.md": "# Orphan\n\n- [ ] work\n",
      "MASTER_PLAN.md": "# MASTER PLAN\n\n- plan: plans/2026-01-01_named.md\n",
    })
    const coverage = masterPlanCoverage(dir)
    expect(coverage.present).toBe(true)
    // `named` is the control that MUST NOT appear: a filter reporting everything, or nothing, would pass
    // one half of this assertion and fail the other. (A filter is a claim about the pattern.)
    expect(coverage.misses).toEqual(["plans/2026-01-02_orphan.md"])
    const report = formatPlanHygiene(getPlanStatus(dir))
    expect(report).toContain("MASTER PLAN GAPS: 1 plan(s)")
    expect(report).toContain("plans/2026-01-02_orphan.md")
  })

  test("a complete map SAYS SO — a check whose silence cannot be told from its absence is not a check", () => {
    const dir = fixture({
      "2026-01-01_named.md": "# Named\n\n- [ ] work\n",
      "MASTER_PLAN.md": "# MASTER PLAN\n\n- plan: plans/2026-01-01_named.md\n",
    })
    expect(masterPlanCoverage(dir).misses).toEqual([])
    expect(formatPlanHygiene(getPlanStatus(dir))).toContain("Master plan: every plan under plans/ is named")
  })

  test("an ABSENT master plan is its own finding, never 'no misses'", () => {
    const dir = fixture({ "2026-01-01_named.md": "# Named\n\n- [ ] work\n" })
    expect(masterPlanCoverage(dir)).toEqual({ present: false, misses: [] })
    expect(formatPlanHygiene(getPlanStatus(dir))).toContain("MASTER PLAN MISSING")
  })

  test("the master plan is NOT a plan: never active, never no-checklist, never moved", () => {
    // The half that ACTS on a wrong answer is `reconcilePlans`, so it is asserted separately: without the
    // `NON_PLAN_FILES` exception the map of all work would be filed as a completed plan the moment its own
    // example boxes closed — the same class `plans/README.md` was exempted for on 2026-09-22.
    const dir = fixture({ "MASTER_PLAN.md": "# MASTER PLAN\n\n- [ ] smoke: written\n- [x] done\n" })
    const status = getPlanStatus(dir)
    expect(status.active).toEqual([])
    expect(status.noChecklist).toEqual([])
    expect(status.misplaced).toEqual([])
    expect(reconcilePlans(dir).movedToCompleted).toEqual([])
  })
})

/**
 * THE UNMOVED-PLAN HAZARD, in the half a script can decide. Owner, 2026-09-30: «в планах иногда задерживается
 * тема, которая уже была переписана и удалена, какой-нибудь агент обязательно это найдёт и под хорошее
 * настроение начнёт исправлять — и это нормально, в планах есть — есть надо сделать — надо. А он же не в
 * курсе что это просто другой агент забыл перенести потому что поленился выполнить тот или иной
 * изолированный тест.» Read in the project's own terms: a stale OPEN box is a SIMULATED status presented as a
 * MEASURED one — the next reader cannot tell it from real work, and the cost of the previous agent's skipped
 * test is moved onto someone who cannot refuse it. The written half is decidable here; the unwritten half (the
 * topic was simply rewritten and deleted) is what the turn note's `map:` question asks every turn.
 */
describe("util.plan-status stale stated plans", () => {
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "plan-stale-"))
    mkdirSync(path.join(dir, "plans"), { recursive: true })
    mkdirSync(path.join(dir, "plans_completed"), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "plans", name), body)
    return dir
  }

  test("a plan that STATES it is over while its boxes are open is reported; an ACTIVE one is not", () => {
    const dir = fixture({
      "2026-01-30_superseded.md": "# S\n\n**Status:** SUPERSEDED\n\n- [ ] work the topic again\n",
      "2026-01-31_live.md": "# L\n\n**Status:** ACTIVE\n\n- [ ] real work\n",
    })
    const status = getPlanStatus(dir)
    // The control that must NOT appear is the ACTIVE plan — a check that reported every open plan would tell
    // the reader nothing, and one that reported none would hide exactly the hazard this exists for.
    expect(status.staleStated).toEqual([{ file: "plans/2026-01-30_superseded.md", lifecycle: "SUPERSEDED" }])
    const report = formatPlanHygiene(status)
    expect(report).toContain("STALE STATED: 1 plan(s)")
    expect(report).toContain("plans/2026-01-30_superseded.md SUPERSEDED")
    expect(report).not.toContain("plans/2026-01-31_live.md ACTIVE")
  })

  test("the STATE axis catches what the CHECKLIST axis cannot — and the two never disagree", () => {
    const dir = fixture({ "2026-01-30_done.md": "# D\n\n**Status:** DONE\n\n- [ ] box left open\n" })
    const status = getPlanStatus(dir)
    // Placement is clean: `misplaced` asks whether every box is TICKED, and this file's box is open, so the
    // placement rule sees nothing at all. The stated state is the only thing that can catch it — which is why
    // it is a second axis and not a second count of the first.
    expect(status.misplaced).toEqual([])
    expect(status.staleStated).toEqual([{ file: "plans/2026-01-30_done.md", lifecycle: "DONE" }])
  })
})

/**
 * THE UNMOVED-PLAN HAZARD, in the half a script can decide. Owner, 2026-09-30: «в планах иногда задерживается
 * тема, которая уже была переписана и удалена, какой-нибудь агент обязательно это найдёт и под хорошее
 * настроение начнёт исправлять — и это нормально, в планах есть — есть надо сделать — надо. А он же не в
 * курсе что это просто другой агент забыл перенести потому что поленился выполнить тот или иной
 * изолированный тест.» A plan that OUTLIVED its topic is a trap: the next reader re-implements work that was
 * already rewritten or deleted. The stated half is decidable here; the unstated half is what the turn note's
 * `map:` question asks, and it needs the code to answer.
 */
describe("util.plan-status stale stated plans", () => {
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "plan-stale-"))
    mkdirSync(path.join(dir, "plans"), { recursive: true })
    mkdirSync(path.join(dir, "plans_completed"), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name === "MASTER_PLAN.md" ? "plans/MASTER_PLAN.md" : `plans/${name}`), body)
    return dir
  }

  test("a plan that STATES it is over while its boxes are open is reported; an ACTIVE one is not", () => {
    const dir = fixture({
      "2026-01-30_superseded.md": "# S\n\n**Status:** SUPERSEDED\n\n- [ ] work the topic again\n",
      "2026-01-31_live.md": "# L\n\n**Status:** ACTIVE\n\n- [ ] real work\n",
    })
    const status = getPlanStatus(dir)
    // The control that MUST NOT be reported is the ACTIVE plan: a check that flagged every open plan would
    // tell the reader nothing, and one that flagged none would hide the hazard.
    expect(status.staleStated).toEqual([{ file: "plans/2026-01-30_superseded.md", lifecycle: "SUPERSEDED" }])
    const report = formatPlanHygiene(status)
    expect(report).toContain("STALE STATED: 1 plan(s)")
    expect(report).toContain("plans/2026-01-30_superseded.md SUPERSEDED")
    expect(report).not.toContain("2026-01-31_live.md ACTIVE")
  })

  test("the state axis catches what the checklist axis cannot — and the two are complementary", () => {
    const dir = fixture({ "2026-01-30_done.md": "# D\n\n**Status:** DONE\n\n- [ ] box left open\n" })
    const status = getPlanStatus(dir)
    expect(status.staleStated.map((p) => p.lifecycle)).toEqual(["DONE"])
    // NOT misplaced: the placement axis asks «are the boxes closed», and this file's are open. That is
    // exactly why the state axis has to exist — the file says it is over, and its checklist disagrees.
    expect(status.misplaced).toEqual([])
  })
})
