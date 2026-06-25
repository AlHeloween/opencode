/**
 * AGI Mode context — autonomous development orchestration.
 *
 * Provides:
 * - agiMode signal (boolean) — whether AGI mode is active
 * - toggleAgiMode() — activate/deactivate AGI mode
 * - planStatus signal — live plan completion stats
 * - progressBar signal — rendered progress bar string
 *
 * When AGI mode activates:
 * 1. Switches primary agent to "orchestrator"
 * 2. Shows plan progress bar in TUI
 * 3. Enables auto-continue after each assistant message
 */
import { createSignal, createMemo, onCleanup } from "solid-js"
import { useLocal } from "./local"
import { useSync } from "./sync"
import { Global } from "@opencode-ai/core/global"
import { getPlanStatus, formatProgressBar, type PlanStatus } from "@/util/plan-status"

export function useAgiMode() {
  const local = useLocal()
  const sync = useSync()
  const [agiMode, setAgiMode] = createSignal(false)
  const [planData, setPlanData] = createSignal<PlanStatus>({ active: [], completed: [], total: 0, completion: 0 })

  /** Refresh plan status from disk. */
  function refreshPlanStatus() {
    const worktree = Global.Path.worktree || Global.Path.home
    setPlanData(getPlanStatus(worktree))
  }

  const progressBar = createMemo(() => formatProgressBar(planData()))

  /** Toggle AGI mode on/off. */
  function toggleAgiMode() {
    if (agiMode()) {
      setAgiMode(false)
      return
    }
    // Activate: switch to orchestrator agent, refresh plans
    const orchestrator = local.agent.list().find((a) => a.name === "orchestrator")
    if (orchestrator) {
      local.agent.set("orchestrator")
    }
    refreshPlanStatus()
    setAgiMode(true)
  }

  return {
    agiMode,
    toggleAgiMode,
    planData,
    progressBar,
    refreshPlanStatus,
  }
}
