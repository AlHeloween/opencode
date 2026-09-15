// One-shot: restore plans my reconcile runs yanked from plans_completed/ back
// to plans/. Detects tracked-deleted plans_completed/X + untracked plans/X
// pairs (same basename) via git status --porcelain and renames them back.
// Usage: bun experiments/2026-08-28_restore-completed-plans.ts [worktree]
import { renameSync } from "fs"
import path from "path"

const worktree = path.resolve(process.argv[2] ?? ".")
const proc = Bun.spawnSync(["git", "status", "--porcelain", "--", "plans", "plans_completed"], {
  cwd: worktree,
})
const out = proc.stdout.toString()
const deletedFromCompleted = new Set<string>()
const untrackedInPlans = new Set<string>()
for (const line of out.split("\n")) {
  const m = line.match(/^(..)\s+(.+)$/)
  if (!m) continue
  const [, status, file] = m
  const rel = file.replace(/\\/g, "/")
  if (status.trim() === "D" && rel.startsWith("plans_completed/")) {
    deletedFromCompleted.add(path.basename(rel))
  } else if (status === "??" && rel.startsWith("plans/")) {
    untrackedInPlans.add(rel)
  }
}

let restored = 0
for (const rel of untrackedInPlans) {
  const base = path.basename(rel)
  if (!deletedFromCompleted.has(base)) continue
  const src = path.join(worktree, rel)
  const dest = path.join(worktree, "plans_completed", base)
  renameSync(src, dest)
  console.log(`restored: plans_completed/${base}`)
  restored++
}
console.log(`done: ${restored} file(s) restored`)
