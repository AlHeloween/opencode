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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import path from "path"

/** Persisted AGI state — survives TUI restarts and route navigation. */
interface AgiState {
  orchSessionID?: string
  mainSessionID?: string
}

function loadAgiState(): AgiState {
  try {
    const file = path.join(Global.Path.state, "agi-state.json")
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, "utf-8"))
  } catch {
    return {}
  }
}

function saveAgiState(state: AgiState) {
  try {
    const file = path.join(Global.Path.state, "agi-state.json")
    writeFileSync(file, JSON.stringify(state))
  } catch { /* non-fatal */ }
}

/** Maximum length of main session output to pass back to orchestrator. */
const MAX_OUTPUT_CHARS = 4000

/** Maximum number of auto-continue turns before safety deactivation.
 *  TODO: make configurable via TUI settings dialog. */
const MAX_TURNS = 100

/** Maximum AGI session runtime in milliseconds before safety deactivation (24h). */
const MAX_RUNTIME_MS = 24 * 60 * 60 * 1000

/** Timestamp when AGI mode was last activated — used for runtime limit. */
let activationStartedAt = 0

/** Module-level AGI mode signal — shared across all useAgiMode() call sites.
 *  Previously each caller created its own createSignal(false), so toggling
 *  from app.tsx didn't update the badge in routes/session/index.tsx. */
const [agiMode, setAgiMode] = createSignal(false)

/** Module-level plan status — shared so refreshPlanStatus from any caller
 *  updates the badge rendered by routes/session/index.tsx. */
const [planData, setPlanData] = createSignal<PlanStatus>({ active: [], completed: [], total: 0, completion: 0 })
const [turnCount, setTurnCount] = createSignal(0)

export function useAgiMode(currentSessionID: () => string | undefined) {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  // Load persisted AGI state (survives TUI restarts, route navigation)
  const persisted = loadAgiState()
  const [mainSessionID, setMainSessionIDRaw] = createSignal<string | undefined>(persisted.mainSessionID)
  const [orchSessionID, setOrchSessionIDRaw] = createSignal<string | undefined>(persisted.orchSessionID)

  /** Set main session ID and persist. */
  function setMainSessionID(id: string | undefined) {
    setMainSessionIDRaw(id)
    saveAgiState({ orchSessionID: orchSessionID(), mainSessionID: id })
  }

  /** Set orchestrator session ID and persist. */
  function setOrchSessionID(id: string | undefined) {
    setOrchSessionIDRaw(id)
    saveAgiState({ orchSessionID: id, mainSessionID: mainSessionID() })
  }

  /** Validate that a session ID still exists in sync data. */
  function sessionExists(sid: string): boolean {
    return sync.data.session.some((s) => s.id === sid)
  }

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

      // Capture instruction now — setTimeout delay could let state change
      const oid = orchSessionID()
      if (!oid) return
      const instruction = lastAssistantText(oid)
      if (!instruction) return

      clearTimeout(orchTimer)
      orchTimer = setTimeout(async () => {
        const ok = await sendToMain(instruction)
        if (!ok) toast.show({ message: "AGI: failed to send instruction to main session", variant: "warning" })
      }, 1000)
    }
    // Main just finished executing → send result to orchestrator
    else if (wasMainPending && !mp && !op) {
      wasMainPending = false
      refreshPlanStatus()

      if (planData().active.length === 0) return

      // Safety: max turns / max runtime to prevent infinite loop
      const t = turnCount() + 1
      if (t > MAX_TURNS) {
        toast.show({ message: `AGI: max turns (${MAX_TURNS}) reached — deactivating`, variant: "info" })
        deactivate(true)
        return
      }

      // Time-based limit: 24h max continuous AGI runtime
      const elapsed = Date.now() - activationStartedAt
      if (elapsed > MAX_RUNTIME_MS) {
        const hours = Math.round(elapsed / 3600000)
        toast.show({ message: `AGI: max runtime (${hours}h) reached — deactivating`, variant: "info" })
        deactivate(true)
        return
      }

      // Capture result now — setTimeout delay could let state change
      const mid = mainSessionID()
      if (!mid) return
      const result = lastAssistantText(mid)
      setTurnCount(t)

      clearTimeout(mainTimer)
      mainTimer = setTimeout(async () => {
        const context = [
          `Turn ${t} complete. Plan progress: ${progressBar()}.`,
          result ? `Last execution result:\n${result.slice(0, MAX_OUTPUT_CHARS)}` : "",
          "Analyze progress against plans/. Check which tasks were completed.",
          "Generate the next instruction for the main session to execute.",
        ].filter(Boolean).join("\n\n")
        const ok = await sendToOrchestrator(context)
        if (!ok) toast.show({ message: "AGI: failed to send results to orchestrator", variant: "warning" })
      }, 1000)
    }
    else {
      wasOrchPending = !!op
      wasMainPending = !!mp
    }
  })

  /** Deactivate AGI mode — pause, don't destroy. */
  async function deactivate(silent = false) {
    clearTimeout(orchTimer)
    clearTimeout(mainTimer)
    orchTimer = undefined
    mainTimer = undefined
    // Don't abort orchestrator — reuse on reactivation
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
    // Reset turn count on each activation — module-level signal persists
    // across sessions, so old counts would immediately hit the 20-turn limit.
    setTurnCount(0)
    activationStartedAt = Date.now()
    // Show enabled badge immediately — before any async work.
    // Previously setAgiMode(true) was at the end, after session creation
    // and orchestrator prompt, leaving the UI in "disabled" state during
    // the entire activation sequence.
    setAgiMode(true)

    try {
      // Use current TUI session as main — reuse if already set
      if (currentSessionID()) {
        setMainSessionID(currentSessionID()!)
      } else if (!mainSessionID() || !sessionExists(mainSessionID()!)) {
        const mainRes = await sdk.client.session.create({})
        if (mainRes.error) {
          setAgiMode(false)
          return
        }
        setMainSessionID(mainRes.data.id)
      }

      // Reuse existing orchestrator session (persisted), or create new one
      const persistedOid = orchSessionID()
      const existed = persistedOid && sessionExists(persistedOid)
      let oid: string
      if (existed) {
        oid = persistedOid!
      } else {
        if (persistedOid) setOrchSessionID(undefined) // clear stale reference
        const orchRes = await sdk.client.session.create({})
        if (orchRes.error) {
          setAgiMode(false)
          return
        }
        oid = orchRes.data.id
        setOrchSessionID(oid)

        // Create memory file if it doesn't exist
        const dataDir = path.join(Global.Path.data, "memory")
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
        const memoryFile = path.join(dataDir, `${oid}_orchestrator.md`)
        if (!existsSync(memoryFile)) writeFileSync(memoryFile,
          `# Orchestrator Memory\n\nCreated: ${new Date().toISOString()}\nSession: ${oid}\n\n---\n\n## Known Issues\n\n## Project Conventions\n\n## Requirements\n\n## Blocked Tasks\n`)
      }

      // Kick off orchestrator only on first activation — not on resume
      if (!existed) {
        const messageID = MessageID.ascending()
        const activePlans = planData().active.join(", ") || "none"
        await sdk.client.session.promptAsync({
          sessionID: oid,
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
      } else {
        // Resume: send continuation to kickstart auto-continue loop
        await sdk.client.session.promptAsync({
          sessionID: oid,
          messageID: MessageID.ascending(),
          agent: "orchestrator",
          parts: [{
            type: "text" as const,
            text: [
              `Resuming. Plan progress: ${progressBar()}.`,
              `Active plans: ${planData().active.join(", ") || "none"}.`,
              "Continue from where you left off. What's the next instruction?",
            ].join("\n"),
          }],
        })
      }

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
