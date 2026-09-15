// One-shot: reconcile plans/ and plans_completed/ per AGENTS.md conventions.
// Usage: bun experiments/2026-08-29_kv-cache-parity/2026-08-28_reconcile_plans.ts [worktree]
import { reconcilePlans } from "../../packages/opencode/src/util/plan-status"

const worktree = process.argv[2] ?? "."
console.log(JSON.stringify(reconcilePlans(worktree), null, 2))
