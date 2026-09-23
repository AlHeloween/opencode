/**
 * /automode — pure decision logic (no Solid, no IO).
 *
 * The TUI context (`automode.tsx`) owns the signals, the plan-status read and the session_status
 * phase machine; the numbers that decide «continue or exit» live here, so they are checkable
 * without a renderer. Owner's contract (2026-09-23), second revision:
 *   - `/automode`         → the mode ends when a plan LEAVES `plans/` (moved to plans_completed or
 *                           plans_deferred). The exit criterion is the MOVE, not «no open boxes»;
 *   - `/automode all`     → it ends only when every plan has been moved (`plans/` is empty);
 *   - `/automode N`       → it ends on the iteration counter alone.
 * The plan check is `getPlanStatus(worktree).active` — the same plan-placement tooling the
 * orchestrator uses for hanging plans, not a private directory scan.
 */

export type AutoModeKind = "current" | "all" | "iterations"

export type AutoModeArgs =
  | { ok: true; kind: "current" | "all"; limit: null }
  | { ok: true; kind: "iterations"; limit: number }
  | { ok: false; error: string }

/** Parse the slash argument: empty → current plan, `all` → every plan, a positive integer → iterations. */
export function parseAutoModeArgs(raw: string): AutoModeArgs {
  const value = raw.trim().toLowerCase()
  if (value === "") return { ok: true, kind: "current", limit: null }
  if (value === "all") return { ok: true, kind: "all", limit: null }
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: `expected no argument, "all", or a positive integer — got: ${raw.trim()}` }
  }
  const limit = Number(value)
  if (limit === 0) return { ok: false, error: "0 iterations is a no-op; omit the number for unlimited" }
  return { ok: true, kind: "iterations", limit }
}

export type AutoModeStopReason = "plan-moved" | "plans-complete" | "limit-reached"
export type AutoModeDecision = { action: "continue" } | { action: "stop"; reason: AutoModeStopReason }

/**
 * One idle moment, one decision.
 * `plansAtStart` / `plansNow` are `getPlanStatus(worktree).active.length` at enable time and now.
 * A DECREASE means a plan was moved out of `plans/` — the owner's exit criterion.
 */
export function autoModeDecision(input: {
  kind: AutoModeKind
  iteration: number
  limit: number | null
  plansAtStart: number
  plansNow: number
}): AutoModeDecision {
  if (input.kind === "all") {
    return input.plansNow === 0 ? { action: "stop", reason: "plans-complete" } : { action: "continue" }
  }
  if (input.kind === "current") {
    return input.plansNow < input.plansAtStart ? { action: "stop", reason: "plan-moved" } : { action: "continue" }
  }
  if (input.limit !== null && input.iteration >= input.limit) return { action: "stop", reason: "limit-reached" }
  return { action: "continue" }
}
