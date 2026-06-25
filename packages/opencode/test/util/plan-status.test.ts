import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { getPlanStatus, formatProgressBar } from "../../src/util/plan-status"

describe("PlanStatus", () => {
  let worktree: string

  beforeAll(async () => {
    const tmp = await tmpdir()
    worktree = tmp.path
    mkdirSync(path.join(worktree, "plans"), { recursive: true })
    mkdirSync(path.join(worktree, "plans", "priority"), { recursive: true })
    mkdirSync(path.join(worktree, "plans", "emergency"), { recursive: true })
    mkdirSync(path.join(worktree, "plans_completed"), { recursive: true })

    writeFileSync(path.join(worktree, "plans", "plan_a.md"), "# Plan A\n[ ] Task 1")
    writeFileSync(path.join(worktree, "plans", "plan_b.md"), "# Plan B\n[ ] Task 2")
    writeFileSync(path.join(worktree, "plans", "priority", "plan_c.md"), "# Priority C\n[ ] Task 3")
    writeFileSync(path.join(worktree, "plans", "emergency", "plan_d.md"), "# Emergency D\n[ ] Task 4")
    writeFileSync(path.join(worktree, "plans_completed", "plan_z.md"), "# Plan Z\n[x] Done")
    writeFileSync(path.join(worktree, "plans_completed", "plan_y.md"), "# Plan Y\n[x] Done")
  })

  afterAll(() => {
    rmSync(worktree, { recursive: true, force: true })
  })

  test("getPlanStatus returns correct active and completed counts", () => {
    const status = getPlanStatus(worktree)
    expect(status.active.length).toBe(4) // plan_a, plan_b, priority/plan_c, emergency/plan_d
    expect(status.completed.length).toBe(2) // plan_z, plan_y
    expect(status.total).toBe(6)
    expect(status.completion).toBe(33) // 2/6 = 33%
  })

  test("getPlanStatus with empty directories returns zeros", () => {
    const emptyDir = path.join(worktree, "empty_test")
    mkdirSync(emptyDir, { recursive: true })
    mkdirSync(path.join(emptyDir, "plans"), { recursive: true })
    mkdirSync(path.join(emptyDir, "plans_completed"), { recursive: true })
    const status = getPlanStatus(emptyDir)
    expect(status.active.length).toBe(0)
    expect(status.completed.length).toBe(0)
    expect(status.total).toBe(0)
    expect(status.completion).toBe(0)
    rmSync(emptyDir, { recursive: true, force: true })
  })

  test("getPlanStatus with missing directories returns zeros", () => {
    const missing = path.join(worktree, "nonexistent")
    const status = getPlanStatus(missing)
    expect(status.active.length).toBe(0)
    expect(status.completed.length).toBe(0)
    expect(status.total).toBe(0)
  })

  test("formatProgressBar renders correct ASCII bar", () => {
    const status = getPlanStatus(worktree)
    const bar = formatProgressBar(status)
    expect(bar).toContain("2/6")
    expect(bar).toContain("33%")
    expect(bar).toContain("█")
    expect(bar).toContain("░")
  })

  test("formatProgressBar at 100% completion", () => {
    const bar = formatProgressBar({ active: [], completed: ["a", "b", "c"], total: 3, completion: 100 })
    expect(bar).toContain("3/3")
    expect(bar).toContain("100%")
  })

  test("formatProgressBar at 0% completion", () => {
    const bar = formatProgressBar({ active: ["a"], completed: [], total: 1, completion: 0 })
    expect(bar).toContain("0/1")
    expect(bar).toContain("0%")
  })

  test("subdirectory plans are counted recursively", () => {
    // Verify priority/plan_c.md and emergency/plan_d.md are in active list
    const status = getPlanStatus(worktree)
    const hasPriority = status.active.some((f) => f.includes("priority"))
    const hasEmergency = status.active.some((f) => f.includes("emergency"))
    expect(hasPriority).toBeTrue()
    expect(hasEmergency).toBeTrue()
  })
})
