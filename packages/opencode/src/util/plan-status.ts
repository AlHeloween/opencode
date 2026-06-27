/**
 * Plan progress tracking utility.
 *
 * Reads the `plans/` and `plans_completed/` directories at the worktree root
 * and returns completion statistics. Used by the orchestrator agent and
 * the AGI mode TUI progress bar.
 *
 * Completion criteria: A plan is COMPLETE if it has NO [ ] items.
 * [x] and [~] both count as complete — only [ ] means incomplete.
 */
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"

export interface PlanStatus {
  active: string[]
  completed: string[]
  total: number
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

  const total = active.length + completed.length
  const completion = total > 0 ? Math.round((completed.length / total) * 100) : 0

  return { active, completed, total, completion }
}

/** Render a simple ASCII progress bar. */
export function formatProgressBar(status: PlanStatus): string {
  const width = 20
  const filled = Math.round((status.completion / 100) * width)
  const empty = width - filled
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${status.completed.length}/${status.total} plans completed (${status.completion}%)`
}
