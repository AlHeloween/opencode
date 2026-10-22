/**
 * t142 — render the master plan with the CURRENT SOURCE, not the running build.
 *
 * WHY THIS EXISTS: the live `opencode` process that serves this session (PID 1400,
 * started 2026-10-21 21:18 UTC) PREDATES commit f1ddc19ef1 (t135 addendum 3,
 * 2026-10-21 22:22 UTC) — the commit that added `isPlanLinked`, the render's
 * `unlinked` row and the per-plan `link:` line. So the `svm render` TOOL in this
 * session runs a renderer that cannot print the linkage this task just created.
 * Measured: its result object had no `unlinked` key, and the body it wrote
 * contains zero `link:` lines.
 *
 * WHAT THIS RUNS: the product's OWN write path — `applyRender` from
 * `src/session/svm.ts`, the same function the tool calls (`src/tool/svm.ts:78`).
 * One implementation, one write; this is not a copy of the renderer, it IS the
 * renderer, loaded from the current tree. The head above `RENDER_MARKER` is
 * preserved by that function's own contract.
 *
 * Usage:  bun render_current_source.ts <worktree>
 */

import { Effect } from "effect"
import { applyRender } from "../../packages/opencode/src/session/svm"

const worktree = process.argv[2]
if (!worktree) {
  console.error("usage: bun render_current_source.ts <worktree>")
  process.exit(2)
}

const result = await Effect.runPromise(applyRender(worktree))
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exit(1)
