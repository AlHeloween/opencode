/**
 * AGI Mode context — autonomous development orchestration.
 *
 * When AGI mode activates:
 * 1. Creates a parallel hidden session with the orchestrator agent
 * 2. Injects initial message to start autonomous development
 * 3. Auto-continue: watches orchestrator session's pending state,
 *    sends continuation messages automatically
 * 4. Tracks plan completion progress
 * 5. Deactivates by aborting the orchestrator session
 *
 * The orchestrator session runs in the background — it reads plans/,
 * delegates implementation to sub-agents (coder, explore), verifies,
 * and moves completed plans to plans_completed/. The main session
 * stays as build/plan, unaffected by AGI mode.
 */
import { createSignal, createMemo, createEffect, onCleanup } from "solid-js"
import { useLocal } from "./local"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { Global } from "@opencode-ai/core/global"
import { getPlanStatus, formatProgressBar, type PlanStatus } from "@/util/plan-status"
import { MessageID } from "@/session/schema"

export function useAgiMode() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [agiMode, setAgiMode] = createSignal(false)
  const [orchSessionID, setOrchSessionID] = createSignal<string | undefined>()
  const [planData, setPlanData] = createSignal<PlanStatus>({ active: [], completed: [], total: 0, completion: 0 })
  const [continueCount, setContinueCount] = createSignal(0)

  /** Refresh plan status from disk. */
  function refreshPlanStatus() {
    const worktree = Global.Path.worktree || Global.Path.home
    setPlanData(getPlanStatus(worktree))
  }

  const progressBar = createMemo(() => formatProgressBar(planData()))

  /** Whether the orchestrator session has a pending (incomplete) assistant message. */
  const orchPending = createMemo(() => {
    const sid = orchSessionID()
    if (!sid || !agiMode()) return
    const msgs = sync.data.message[sid] ?? []
    return msgs.findLast((x) => x.role === "assistant" && !x.time.completed)
  })

  /** Auto-continue: when orchestrator assistant completes, send next continuation. */
  let wasPending = false
  createEffect(() => {
    const p = orchPending()
    if (!agiMode()) {
      wasPending = !!p
      return
    }
    // Transition: was processing → now idle
    if (wasPending && !p) {
      wasPending = false
      refreshPlanStatus()

      // Check if all plans are completed
      if (planData().active.length === 0) {
        // All plans done — keep AGI mode active but stop auto-continue
        return
      }

      // Send continuation to orchestrator session
      setTimeout(() => {
        const sid = orchSessionID()
        if (!sid) return
        const n = continueCount() + 1
        setContinueCount(n)
        sdk.client.session.promptAsync({
          sessionID: sid,
          messageID: MessageID.ascending(),
          agent: "orchestrator",
          parts: [{
            type: "text" as const,
            text: `Continue autonomous development (turn ${n}). Plans: ${progressBar()}. Pick the next actionable plan and implement it.`,
          }],
        }).catch(() => { /* session may have been aborted */ })
      }, 1000)
    } else {
      wasPending = !!p
    }
  })

  /** Deactivate AGI mode — abort orchestrator session. */
  async function deactivate() {
    const sid = orchSessionID()
    if (sid) {
      try {
        await sdk.client.session.abort({ sessionID: sid })
      } catch { /* session may already be stopped */ }
    }
    setOrchSessionID(undefined)
    setContinueCount(0)
    setAgiMode(false)
  }

  onCleanup(() => {
    if (agiMode()) deactivate()
  })

  /** Toggle AGI mode on/off. */
  async function toggleAgiMode() {
    if (agiMode()) {
      await deactivate()
      return
    }

    // Activate: create parallel orchestrator session
    const orchestrator = local.agent.list().find((a) => a.name === "orchestrator")
    if (!orchestrator) return

    try {
      const res = await sdk.client.session.create({})
      if (res.error) return

      const sessionID = res.data.id
      setOrchSessionID(sessionID)

      // Send initial message to kick off autonomous development
      const messageID = MessageID.ascending()
      await sdk.client.session.promptAsync({
        sessionID,
        messageID,
        agent: "orchestrator",
        parts: [{
          type: "text" as const,
          text: "Start autonomous development. Read the plans/ directory, identify the next actionable plan respecting the dependency graph, and begin implementation by delegating to appropriate sub-agents. Report progress after each completed task.",
        }],
      })

      refreshPlanStatus()
      setAgiMode(true)
    } catch {
      // Session creation failed — remain inactive
    }
  }

  return {
    agiMode,
    toggleAgiMode,
    orchSessionID,
    orchPending,
    planData,
    progressBar,
    refreshPlanStatus,
    deactivate,
  }
}
