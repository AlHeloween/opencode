import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import {
  getPlanStatus,
  formatProgressBar,
  reconcilePlans,
  isPlanHygieneClean,
  hasOpenItems,
  planHygieneWorkerFooter,
  formatPlanHygiene,
} from "../../src/util/plan-status"

describe("PlanStatus", () => {
  let worktree: string

  beforeAll(async () => {
    const tmp = await tmpdir()
    worktree = tmp.path
    mkdirSync(path.join(worktree, "plans"), { recursive: true })
    mkdirSync(path.join(worktree, "plans", "priority"), { recursive: true })
    mkdirSync(path.join(worktree, "plans", "emergency"), { recursive: true })
    mkdirSync(path.join(worktree, "plans_completed"), { recursive: true })

    writeFileSync(path.join(worktree, "plans", "plan_a.md"), "# Plan A\n- [ ] Task 1")
    writeFileSync(path.join(worktree, "plans", "plan_b.md"), "# Plan B\n- [ ] Task 2")
    writeFileSync(path.join(worktree, "plans", "priority", "plan_c.md"), "# Priority C\n- [ ] Task 3")
    writeFileSync(path.join(worktree, "plans", "emergency", "plan_d.md"), "# Emergency D\n- [ ] Task 4")
    writeFileSync(path.join(worktree, "plans_completed", "plan_z.md"), "# Plan Z\n- [x] Done")
    writeFileSync(path.join(worktree, "plans_completed", "plan_y.md"), "# Plan Y\n- [x] Done")
  })

  afterAll(() => {
    rmSync(worktree, { recursive: true, force: true })
  })

  test("getPlanStatus returns correct active and completed counts", () => {
    const status = getPlanStatus(worktree)
    expect(status.active.length).toBe(2) // plan_a, plan_b only (flat — subdirs ignored)
    expect(status.completed.length).toBe(2) // plan_z, plan_y
    expect(status.totalPlans).toBe(4)
    expect(status.totalTasks).toBe(4)
    expect(status.completedTasks).toBe(2)
    expect(status.completion).toBe(50) // 2/4 = 50%
  })

  test("getPlanStatus with empty directories returns zeros", () => {
    const emptyDir = path.join(worktree, "empty_test")
    mkdirSync(emptyDir, { recursive: true })
    mkdirSync(path.join(emptyDir, "plans"), { recursive: true })
    mkdirSync(path.join(emptyDir, "plans_completed"), { recursive: true })
    const status = getPlanStatus(emptyDir)
    expect(status.active.length).toBe(0)
    expect(status.completed.length).toBe(0)
    expect(status.totalPlans).toBe(0)
    expect(status.totalTasks).toBe(0)
    expect(status.completedTasks).toBe(0)
    expect(status.completion).toBe(0)
    rmSync(emptyDir, { recursive: true, force: true })
  })

  test("getPlanStatus with missing directories returns zeros", () => {
    const missing = path.join(worktree, "nonexistent")
    const status = getPlanStatus(missing)
    expect(status.active.length).toBe(0)
    expect(status.completed.length).toBe(0)
    expect(status.totalPlans).toBe(0)
    expect(status.totalTasks).toBe(0)
  })

  test("formatProgressBar renders correct ASCII bar", () => {
    const status = getPlanStatus(worktree)
    const bar = formatProgressBar(status)
    expect(bar).toContain("2/4 plans")
    expect(bar).toContain("2/4 tasks")
    expect(bar).toContain("50%")
    expect(bar).toContain("█")
    expect(bar).toContain("░")
  })

  test("formatProgressBar at 100% completion", () => {
    const bar = formatProgressBar({ active: [], completed: ["a", "b", "c"], misplaced: [], totalPlans: 3, totalTasks: 0, completedTasks: 0, completion: 100 })
    expect(bar).toContain("3/3")
    expect(bar).toContain("100%")
  })

  test("formatProgressBar at 0% completion", () => {
    const bar = formatProgressBar({ active: ["a"], completed: [], misplaced: [], totalPlans: 1, totalTasks: 0, completedTasks: 0, completion: 0 })
    expect(bar).toContain("0/1")
    expect(bar).toContain("0%")
  })

  test("formatProgressBar shows misplaced count", () => {
    const bar = formatProgressBar({
      active: [],
      completed: ["a"],
      misplaced: ["plans/done.md"],
      totalPlans: 2,
      totalTasks: 1,
      completedTasks: 1,
      completion: 50,
    })
    expect(bar).toContain("misplaced:1")
  })

  test("subdirectory plans are NOT collected (flat only)", () => {
    const status = getPlanStatus(worktree)
    const hasPriority = status.active.some((f) => f.includes("priority"))
    const hasEmergency = status.active.some((f) => f.includes("emergency"))
    expect(hasPriority).toBeFalse()
    expect(hasEmergency).toBeFalse()
  })

  test("isPlanHygieneClean requires zero active and zero misplaced", () => {
    expect(isPlanHygieneClean({ active: [], completed: ["a"], misplaced: [], totalPlans: 1, totalTasks: 0, completedTasks: 0, completion: 100 })).toBe(true)
    expect(isPlanHygieneClean({ active: ["a"], completed: [], misplaced: [], totalPlans: 1, totalTasks: 1, completedTasks: 0, completion: 0 })).toBe(false)
    expect(isPlanHygieneClean({ active: [], completed: [], misplaced: ["plans/x.md"], totalPlans: 1, totalTasks: 0, completedTasks: 0, completion: 0 })).toBe(false)
  })

  test("planHygieneWorkerFooter mentions plans_completed, smoke, and reuse", () => {
    const footer = planHygieneWorkerFooter()
    expect(footer).toContain("plans_completed")
    expect(footer).toContain("[x]")
    expect(footer).toContain("Smoke Tests")
    expect(footer).toContain("baseline")
    expect(footer).toContain("REUSE.BEFORE")
    expect(footer).toContain("universalsearch")
  })
})

describe("reconcilePlans", () => {
  let worktree: string

  beforeEach(async () => {
    const tmp = await tmpdir()
    worktree = tmp.path
    mkdirSync(path.join(worktree, "plans", "nested"), { recursive: true })
    mkdirSync(path.join(worktree, "plans_completed"), { recursive: true })
  })

  afterAll(() => {
    // tmpdir fixtures cleaned by suite lifecycle; best-effort
  })

  test("moves fully-checked plans from plans/ to plans_completed/", () => {
    writeFileSync(path.join(worktree, "plans", "done.md"), "# Done\n- [x] a\n- [~] b\n")
    writeFileSync(path.join(worktree, "plans", "open.md"), "# Open\n- [ ] still\n")
    writeFileSync(path.join(worktree, "plans", "nested", "done2.md"), "# Nested\n- [x] ok\n")

    const result = reconcilePlans(worktree)
    expect(result.movedToCompleted).toContain("done.md")
    // nested/done2.md is NOT collected (flat collectPlans ignores subdirectories)
    expect(result.movedToCompleted.some((p) => p.includes("done2.md"))).toBe(false)
    expect(result.reopenedToActive).toEqual([])
    expect(existsSync(path.join(worktree, "plans", "done.md"))).toBe(false)
    expect(existsSync(path.join(worktree, "plans_completed", "done.md"))).toBe(true)
    expect(existsSync(path.join(worktree, "plans", "open.md"))).toBe(true)
    expect(hasOpenItems(path.join(worktree, "plans", "open.md"))).toBe(true)
    expect(result.status.active).toContain("open.md")
    expect(result.status.misplaced.filter((m) => m.startsWith("plans/"))).toEqual([])
    // nested file untouched — still present
    expect(existsSync(path.join(worktree, "plans", "nested", "done2.md"))).toBe(true)
  })

  test("reopens incomplete plans from plans_completed/ to plans/", () => {
    writeFileSync(path.join(worktree, "plans_completed", "premature.md"), "# Premature\n- [x] a\n- [ ] b\n")
    writeFileSync(path.join(worktree, "plans_completed", "good.md"), "# Good\n- [x] only\n")

    const result = reconcilePlans(worktree)
    expect(result.reopenedToActive).toContain("premature.md")
    expect(result.movedToCompleted).toEqual([])
    expect(existsSync(path.join(worktree, "plans", "premature.md"))).toBe(true)
    expect(existsSync(path.join(worktree, "plans_completed", "premature.md"))).toBe(false)
    expect(existsSync(path.join(worktree, "plans_completed", "good.md"))).toBe(true)
    expect(result.status.active).toContain("premature.md")
    expect(result.status.completed).toContain("good.md")
  })

  test("full reconcile yields clean hygiene when no open items remain", () => {
    writeFileSync(path.join(worktree, "plans", "all_done.md"), "# All\n- [x] 1\n")
    writeFileSync(path.join(worktree, "plans_completed", "also_done.md"), "# Also\n- [x] 2\n")

    const result = reconcilePlans(worktree)
    expect(result.movedToCompleted).toContain("all_done.md")
    expect(isPlanHygieneClean(result.status)).toBe(true)
    expect(result.status.active).toEqual([])
    expect(result.status.misplaced).toEqual([])
  })

  test("collision uses unique destination name", () => {
    writeFileSync(path.join(worktree, "plans", "same.md"), "# New done\n- [x] y\n")
    writeFileSync(path.join(worktree, "plans_completed", "same.md"), "# Old done\n- [x] x\n")

    const result = reconcilePlans(worktree)
    expect(result.movedToCompleted.length).toBe(1)
    expect(existsSync(path.join(worktree, "plans_completed", "same.md"))).toBe(true)
    expect(
      existsSync(path.join(worktree, "plans_completed", "same_1.md")) ||
        result.movedToCompleted.some((p) => p.includes("same_1")),
    ).toBe(true)
  })

  test("formatPlanHygiene flags debt", () => {
    const status = getPlanStatus(worktree)
    writeFileSync(path.join(worktree, "plans", "open.md"), "- [ ] x\n")
    const s = getPlanStatus(worktree)
    const text = formatPlanHygiene(s)
    expect(text).toContain("HYGIENE DEBT")
    expect(text).toContain("Active")
  })

  test("before reconcile: fully checked file in plans is misplaced", () => {
    writeFileSync(path.join(worktree, "plans", "stuck.md"), "- [x] done\n")
    const before = getPlanStatus(worktree)
    expect(before.misplaced.some((m) => m.includes("stuck.md"))).toBe(true)
    expect(isPlanHygieneClean(before)).toBe(false)
    const after = reconcilePlans(worktree)
    expect(after.movedToCompleted.some((m) => m.includes("stuck"))).toBe(true)
    expect(after.status.misplaced.some((m) => m.includes("stuck"))).toBe(false)
  })
})
