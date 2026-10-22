/**
 * t142 — the `planstatus` tool's OWN output, produced from the current source.
 *
 * WHY NOT THE TOOL: the live `opencode` process serving this session (PID 1400,
 * started 2026-10-21 21:18 UTC) PREDATES the linkage gate (`f1ddc19ef1`,
 * 2026-10-21 22:22 UTC) — its build has no `unlinked` counter and no
 * `Unlinked:` line. This script calls the SAME five functions the tool's
 * `execute` calls (`src/tool/plan-status.ts:49-57`: `getPlanStatus`,
 * `planDebt`, `parsePlanFiles`, `isPlanLinked`, `formatPlanHygiene`) and
 * composes the SAME four lines. One implementation, one predicate — this is
 * the tool's arithmetic, not a copy of it.
 *
 * Usage:  bun planstatus_from_source.ts <worktree>
 */

import {
  formatPlanHygiene,
  getPlanStatus,
  isPlanLinked,
  parsePlanFiles,
  planDebt,
} from "../../packages/opencode/src/util/plan-status"

const worktree = process.argv[2]
if (!worktree) {
  console.error("usage: bun planstatus_from_source.ts <worktree>")
  process.exit(2)
}

const status = getPlanStatus(worktree)
const debt = planDebt(worktree)
const linked = parsePlanFiles(worktree)
const unlinked = linked.filter((p) => !isPlanLinked(p)).map((p) => p.file)

const output = [
  formatPlanHygiene(status, undefined),
  `Debt: ${debt.open} open box(es) across ${debt.plans} plan(s) in plans/`,
  `Active: ${status.active.length} · Completed: ${status.completed.length} · Misplaced: ${status.misplaced.length}`,
  `Unlinked: ${unlinked.length} plan(s) name no master-plan goal${unlinked.length ? ` (${unlinked.join(", ")})` : ""}`,
].join("\n")

console.log(output)
console.log(
  `\n[title] planstatus: ${status.active.length} active · ${debt.open} open box(es) · ${status.misplaced.length} misplaced · ${unlinked.length} unlinked`,
)
process.exit(0)
