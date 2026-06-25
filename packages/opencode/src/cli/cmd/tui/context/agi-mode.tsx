/**
 * AGI Mode context — autonomous development orchestration.
 *
 * Bidirectional flow:
 *   Orchestrator (hidden session, reasoning) → generates instructions
 *   Main session (build/plan) → executes, delegates to sub-agents
 *   Orchestrator observes results → generates next instructions
 *
 * When AGI mode activates:
 * 1. Records the main session ID
 * 2. Creates a parallel hidden session with the orchestrator agent
 * 3. Sends initial message to orchestrator: "Analyze plans/ and generate first instruction"
 * 4. When orchestrator completes: takes its output text, sends as user message
 *    to the MAIN session for execution
 * 5. When main session completes: passes result back to orchestrator for analysis
 * 6. Loop until all plans completed or user interrupts
 */
import { createSignal, createMemo, createEffect, onCleanup } from "solid-js"
import { useLocal } from "./local"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { useToast } from "../ui/toast"
import { Global } from "@opencode-ai/core/global"
import { getPlanStatus, formatProgressBar, type PlanStatus } from "@/util/plan-status"
import { MessageID } from "@/session/schema"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import path from "path"

/** Maximum length of main session output to pass back to orchestrator. */
const MAX_OUTPUT_CHARS = 4000

export function useAgiMode() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [agiMode, setAgiMode] = createSignal(false)
  const [mainSessionID, setMainSessionID] = createSignal<string | undefined>()
  const [orchSessionID, setOrchSessionID] = createSignal<string | undefined>()
  const [planData, setPlanData] = createSignal<PlanStatus>({ active: [], completed: [], total: 0, completion: 0 })
  const [turnCount, setTurnCount] = createSignal(0)

  function refreshPlanStatus() {
    const worktree = Global.Path.worktree || Global.Path.home
    setPlanData(getPlanStatus(worktree))
  }

  const progressBar = createMemo(() => formatProgressBar(planData()))

  /** Pending state for orchestrator session. */
  const orchPending = createMemo(() => {
    const sid = orchSessionID()
    if (!sid) return
    const msgs = sync.data.message[sid] ?? []
    return msgs.findLast((x) => x.role === "assistant" && !x.time.completed)
  })

  /** Pending state for main session. */
  const mainPending = createMemo(() => {
    const sid = mainSessionID()
    if (!sid) return
    const msgs = sync.data.message[sid] ?? []
    return msgs.findLast((x) => x.role === "assistant" && !x.time.completed)
  })

  /** Get the last assistant text from a session. */
  function lastAssistantText(sessionID: string): string {
    const msgs = sync.data.message[sessionID] ?? []
    const last = msgs.findLast((x) => x.role === "assistant")
    if (!last) return ""
    const parts = sync.data.part[last.id] ?? []
    return parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join("\n")
      .slice(0, MAX_OUTPUT_CHARS)
  }

  /** Send instruction to main session for execution. */
  async function sendToMain(instruction: string) {
    const mid = mainSessionID()
    if (!mid) return false
    try {
      await sdk.client.session.promptAsync({
        sessionID: mid,
        messageID: MessageID.ascending(),
        parts: [{ type: "text" as const, text: instruction }],
      })
      return true
    } catch {
      return false
    }
  }

  /** Send context to orchestrator for analysis. */
  async function sendToOrchestrator(context: string) {
    const oid = orchSessionID()
    if (!oid) return false
    try {
      await sdk.client.session.promptAsync({
        sessionID: oid,
        messageID: MessageID.ascending(),
        agent: "orchestrator",
        parts: [{ type: "text" as const, text: context }],
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Bidirectional auto-continue state machine.
   *
   * States:
   *   IDLE → ORCH_THINKING → MAIN_EXECUTING → ORCH_THINKING → ...
   *
   * Transitions:
   *   orch completes  → send orch output to main  → MAIN_EXECUTING
   *   main completes  → send main result to orch   → ORCH_THINKING
   */
  let wasOrchPending = false
  let wasMainPending = false
  let orchTimer: ReturnType<typeof setTimeout> | undefined
  let mainTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (!agiMode()) return

    const op = orchPending()
    const mp = mainPending()

    // Orchestrator just finished thinking → send instruction to main
    if (wasOrchPending && !op && !mp) {
      wasOrchPending = false
      refreshPlanStatus()

      if (planData().active.length === 0) return // all plans done

      clearTimeout(orchTimer)
      orchTimer = setTimeout(async () => {
        const oid = orchSessionID()
        if (!oid) return
        const instruction = lastAssistantText(oid)
        if (instruction) {
          await sendToMain(instruction)
        }
      }, 1000)
    }
    // Main just finished executing → send result to orchestrator
    else if (wasMainPending && !mp && !op) {
      wasMainPending = false
      refreshPlanStatus()

      if (planData().active.length === 0) return

      clearTimeout(mainTimer)
      mainTimer = setTimeout(async () => {
        const mid = mainSessionID()
        if (!mid) return
        const result = lastAssistantText(mid)
        const t = turnCount() + 1
        setTurnCount(t)
        // Compact orchestrator context every 5 turns
        if (t % 5 === 0) {
          compactOrchestrator().catch(() => {})
        }
        const context = [
          `Turn ${t} complete. Plan progress: ${progressBar()}.`,
          result ? `Last execution result:\n${result.slice(0, MAX_OUTPUT_CHARS)}` : "",
          "Analyze progress against plans/. Check which tasks were completed.",
          "Generate the next instruction for the main session to execute.",
        ].filter(Boolean).join("\n\n")
        await sendToOrchestrator(context)
      }, 1000)
    }
    else {
      wasOrchPending = !!op
      wasMainPending = !!mp
    }
  })

  /** Deactivate AGI mode. */
  async function deactivate(silent = false) {
    clearTimeout(orchTimer)
    clearTimeout(mainTimer)
    orchTimer = undefined
    mainTimer = undefined
    const oid = orchSessionID()
    if (oid) {
      try { await sdk.client.session.abort({ sessionID: oid }) } catch { /* ok */ }
    }
    setOrchSessionID(undefined)
    setMainSessionID(undefined)
    setTurnCount(0)
    setAgiMode(false)
    if (!silent) toast.show({ message: "AGI mode deactivated", variant: "info" })
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

    refreshPlanStatus()

    try {
      // Create orchestrator session
      const orchRes = await sdk.client.session.create({})
      if (orchRes.error) return
      setOrchSessionID(orchRes.data.id)

      // Create main execution session (separate from current TUI session)
      const mainRes = await sdk.client.session.create({})
      if (mainRes.error) {
        try { await sdk.client.session.abort({ sessionID: orchRes.data.id }) } catch { /* ok */ }
        return
      }
      setMainSessionID(mainRes.data.id)

      // Create memory file if it doesn't exist
      const dataDir = path.join(Global.Path.data, "memory")
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
      const memoryFile = path.join(dataDir, `${orchRes.data.id}_orchestrator.md`)
      if (!existsSync(memoryFile)) writeFileSync(memoryFile,
        `# Orchestrator Memory\n\nCreated: ${new Date().toISOString()}\nSession: ${orchRes.data.id}\n\n---\n\n## Known Issues\n\n## Project Conventions\n\n## Requirements\n\n## Blocked Tasks\n`)

      // Kick off: orchestrator analyzes plans and generates first instruction
      const messageID = MessageID.ascending()
      const activePlans = planData().active.join(", ") || "none"
      await sdk.client.session.promptAsync({
        sessionID: orchRes.data.id,
        messageID,
        agent: "orchestrator",
        parts: [{
          type: "text" as const,
          text: [
            `Plan progress: ${progressBar()}.`,
            `Active plans: ${activePlans}.`,
            `Completed plans: ${planData().completed.length}.`,
            "",
            "Analyze the current state. Read the active plans to understand what needs to be done.",
            "Check the dependency graph in the master plan.",
            "Generate a clear, specific instruction for the main session to execute next.",
            "The main session has full edit/write/bash/task permissions and will execute your instruction.",
            "Focus on ONE actionable task per instruction. Be specific about files and expected outcomes.",
          ].join("\n"),
        }],
      })

      setAgiMode(true)
      toast.show({ message: "AGI mode activated", variant: "success" })
    } catch (err) {
      console.error("AGI mode activation failed:", err)
      toast.show({ message: `AGI mode failed: ${err instanceof Error ? err.message : String(err)}`, variant: "error" })
      await deactivate(true)
    }
  }

  /** Orchestrator session message count and token estimate. */
  const orchStats = createMemo(() => {
    const sid = orchSessionID()
    if (!sid) return { messages: 0, tokens: 0 }
    const msgs = sync.data.message[sid] ?? []
    const parts = msgs.flatMap((m) => sync.data.part[m.id] ?? [])
    const textLen = parts
      .filter((p: any) => p.type === "text")
      .reduce((sum: number, p: any) => sum + (p.text?.length ?? 0), 0)
    return {
      messages: msgs.length,
      tokens: Math.ceil(textLen / 4),
    }
  })

  /** Compact the orchestrator session. */
  async function compactOrchestrator() {
    const oid = orchSessionID()
    if (!oid) return
    try {
      await sdk.client.session.summarize({ sessionID: oid })
    } catch { /* may not be supported or session idle */ }
  }

  return {
    agiMode,
    toggleAgiMode,
    orchSessionID,
    mainSessionID,
    planData,
    progressBar,
    orchStats,
    compactOrchestrator,
    refreshPlanStatus,
    deactivate,
  }
}
