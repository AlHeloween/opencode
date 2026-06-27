/**
 * Plan progress tracking utility.
 *
 * Reads the `plans/` and `plans_completed/` directories at the worktree root
 * and returns completion statistics. Used by the orchestrator agent and
 * the AGI mode TUI progress bar.
 *
 * Completion criteria: A plan is COMPLETE if it has NO [ ] items.
 * [x] and [~] both count as complete — only [ ] means incomplete.
 *
 * Task counting: Every [ ], [x], [~] checkbox across ALL plan files
 * is counted. A checkbox is "done" if it is [x] or [~].
 */
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"

export interface PlanStatus {
  active: string[]
  completed: string[]
  misplaced: string[]
  totalPlans: number
  totalTasks: number
  completedTasks: number
  completion: number
}

/** Check if a plan file has any open [ ] items. */
function hasOpenItems(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8")
    return /^\s*- \[ \]/m.test(content)
  } catch {
    return false
  }
}

/** Count all task checkboxes in a plan file: returns { total, done }.
 *  Done = [x] or [~], total = [ ] + [x] + [~]. */
function countTasks(filePath: string): { total: number; done: number } {
  try {
    const content = readFileSync(filePath, "utf-8")
    const pending = content.match(/^\s*- \[ \]/gm)?.length ?? 0
    const done = content.match(/^\s*- \[[x~]\]/gm)?.length ?? 0
    return { total: pending + done, done }
  } catch {
    return { total: 0, done: 0 }
  }
}

/** Recursively collect .md filenames under a directory. */
function collectPlans(dir: string): string[] {
  if (!existsSync(dir)) return []
  const result: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const sub of collectPlans(path.join(dir, entry.name))) {
          result.push(path.join(entry.name, sub))
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(path.join(entry.name))
      }
    }
  } catch {
    // Permission errors or missing dirs → empty
  }
  return result
}

/** Get plan completion status for a worktree. */
export function getPlanStatus(worktree: string): PlanStatus {
  const plansDir = path.join(worktree, "plans")
  const completedDir = path.join(worktree, "plans_completed")

  const allCompleted = collectPlans(completedDir)
  const allActive = collectPlans(plansDir)

  // A plan is complete if it has NO [ ] items (only [x] and [~] allowed)
  const completed = allCompleted.filter((f) => !hasOpenItems(path.join(completedDir, f)))
  const active = allActive.filter((f) => hasOpenItems(path.join(plansDir, f)))

  // Misplaced: plans in completedDir that still have [ ] items,
  // or plans in plansDir that have NO [ ] items (should be moved)
  const misplacedCompleted = allCompleted.filter((f) => hasOpenItems(path.join(completedDir, f)))
  const misplacedActive = allActive.filter((f) => !hasOpenItems(path.join(plansDir, f)))
  const misplaced = [...misplacedCompleted.map((f) => `plans_completed/${f}`), ...misplacedActive.map((f) => `plans/${f}`)]

  const totalPlans = allActive.length + allCompleted.length

  // Count tasks across ALL plan files
  let totalTasks = 0
  let completedTasks = 0
  for (const f of allCompleted) {
    const { total, done } = countTasks(path.join(completedDir, f))
    totalTasks += total
    completedTasks += done
  }
  for (const f of allActive) {
    const { total, done } = countTasks(path.join(plansDir, f))
    totalTasks += total
    completedTasks += done
  }

  const completion = totalPlans > 0 ? Math.round((completed.length / totalPlans) * 100) : 0

  return {
    active,
    completed,
    misplaced,
    totalPlans,
    totalTasks,
    completedTasks,
    completion,
  }
}

/** Render a simple ASCII progress bar with task-level stats. */
export function formatProgressBar(status: PlanStatus): string {
  const width = 20
  const filled = Math.round((status.completion / 100) * width)
  const empty = width - filled
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${status.completed.length}/${status.totalPlans} plans ${status.completedTasks}/${status.totalTasks} tasks (${status.completion}%)`
}
