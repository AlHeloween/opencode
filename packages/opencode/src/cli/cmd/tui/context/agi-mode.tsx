/**
 * AGI Mode context — status-driven autonomous development orchestration.
 *
 * Architecture:
 *   Orchestrator (hidden session, reasoning agent) → produces worker directives
 *   Workers (main session + future sessions) → execute tasks
 *   AGI loop observes session_status signals only — no hash guessing, no duplicate suppression
 *
 * State machine phases:
 *   BOOTSTRAP        → initial prompt sent to orchestrator, waiting for orch busy
 *   ORCH_BUSY        → orchestrator processing, waiting for orch idle
 *   ORCH_DISPATCH    → orchestrator idle, parse directives, dispatch to workers
 *   WORKERS_BUSY     → waiting for all workers to complete
 *   WORKERS_COLLECT  → all workers idle, collect output, send to orchestrator
 *
 * Error handling:
 *   session.error event → deactivate AGI loop, report error for debugging
 *   MAX_TURNS / MAX_RUNTIME → safety deactivation
 */
import { createSignal, createMemo, createEffect, onCleanup } from "solid-js"
import { useLocal } from "./local"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { useEvent } from "./event"
import { useToast } from "../ui/toast"
import { Global } from "@opencode-ai/core/global"
import { getPlanStatus, formatProgressBar, type PlanStatus } from "@/util/plan-status"
import { MessageID } from "@/session/schema"
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import path from "path"
import { execSync } from "child_process"
import { errorMessage } from "@/util/error"

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
  } catch (e) { console.debug("agi state save failed", e) }
}

/**
 * Ensure git is initialized in the worktree. Returns true if ready.
 * If .git is missing, runs git init + creates .gitignore + initial commit.
 */
function ensureGitInit(worktree: string): boolean {
  const gitDir = path.join(worktree, ".git")
  if (existsSync(gitDir)) return true

  try {
    execSync("git init", { cwd: worktree, stdio: "ignore" })

    // Create .gitignore if missing
    const gitignore = path.join(worktree, ".gitignore")
    if (!existsSync(gitignore)) {
      writeFileSync(gitignore, [
        "node_modules/",
        ".opencode/data/",
        ".temp/",
        "dist/",
        "build/",
        "*.log",
        ".env",
        ".env.local",
      ].join("\n"))
    }

    // Initial commit
    execSync("git add -A", { cwd: worktree, stdio: "ignore" })
    execSync('git commit -m "initial commit (auto-init by AGI mode)" --allow-empty', { cwd: worktree, stdio: "ignore" })
    return true
  } catch (e) {
    console.debug("git init failed", e)
    return false
  }
}

/**
 * Create an improvement branch and return the branch name.
 * Returns undefined if branch creation fails.
 */
function createImprovementBranch(worktree: string, cycleNumber: number): string | undefined {
  const branchName = `improvement/cycle-${cycleNumber}`
  try {
    // Check current branch
    const currentBranch = execSync("git branch --show-current", { cwd: worktree, encoding: "utf-8" }).trim()

    // Create and checkout new branch
    execSync(`git checkout -b ${branchName}`, { cwd: worktree, stdio: "ignore" })
    return branchName
  } catch (e) {
    console.debug("branch creation failed", e)
    return undefined
  }
}

/**
 * Merge improvement branch back to main. Returns true if successful.
 */
function mergeImprovementBranch(worktree: string, branchName: string): boolean {
  const wt = Global.Path.worktree || Global.Path.home
  try {
    // Try to detect main branch: origin/HEAD → main → master
    let mainBranch = "main"
    try {
      mainBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
        cwd: wt,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().replace("refs/remotes/origin/", "")
    } catch {
      // No remote HEAD — try common defaults
      try {
        execSync("git rev-parse --verify main", { cwd: wt, stdio: "ignore" })
        mainBranch = "main"
      } catch {
        mainBranch = "master"
      }
    }

    execSync(`git checkout ${mainBranch}`, { cwd: wt, stdio: "ignore" })
    execSync(`git merge ${branchName} --no-ff -m "merge ${branchName}"`, { cwd: wt, stdio: "ignore" })
    return true
  } catch (e) {
    console.debug("branch merge failed", e)
    return false
  }
}

/** Maximum length of worker session output to pass back to orchestrator. */
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

/** Module-level evolving mode signal — when true, orchestrator generates improvement plans after all active plans complete. */
const [evolvingMode, setEvolvingMode] = createSignal(false)

/** Module-level plan status — shared so refreshPlanStatus from any caller
 *  updates the badge rendered by routes/session/index.tsx. */
const [planData, setPlanData] = createSignal<PlanStatus>({ active: [], completed: [], misplaced: [], totalPlans: 0, totalTasks: 0, completedTasks: 0, completion: 0 })
const [turnCount, setTurnCount] = createSignal(0)
const [cycleCount, setCycleCount] = createSignal(0)
const [totalCost, setTotalCost] = createSignal(0)

/** AGI loop phases — status-driven state machine. */
type LoopPhase =
  | "BOOTSTRAP"       // initial prompt sent to orch, waiting for orch busy
  | "ORCH_BUSY"       // orchestrator processing
  | "ORCH_DISPATCH"   // orch idle → parse directives → dispatch to workers
  | "WORKERS_BUSY"    // waiting for all workers to complete
  | "WORKERS_COLLECT" // all workers idle → collect output → send to orch

/** Worker directive parsed from orchestrator output. */
interface WorkerDirective {
  workerId: string
  message: string
}

export function useAgiMode(currentSessionID: () => string | undefined) {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const event = useEvent()
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

  /** Whether the orchestrator session is busy (runLoop active).
   *  Uses session_status from sync — transitions to idle only when runLoop fully
   *  exits, not on intermediate assistant completions during tool-call rounds. */
  const orchBusy = createMemo(() => {
    const sid = orchSessionID()
    if (!sid) return false
    const s = sync.data.session_status?.[sid] as { type: string } | undefined
    return s?.type === "busy" || s?.type === "compacting"
  })

  /** Whether the main session is busy (runLoop active). */
  const mainBusy = createMemo(() => {
    const sid = mainSessionID()
    if (!sid) return false
    const s = sync.data.session_status?.[sid] as { type: string } | undefined
    return s?.type === "busy" || s?.type === "compacting"
  })

  /** Get the last completed assistant text from a session.
   *  Only reads from messages with time.completed set — avoids capturing
   *  partial streaming text from mid-stream responses. */
  function lastAssistantText(sessionID: string): string {
    const msgs = sync.data.message[sessionID] ?? []
    const last = msgs.findLast((x) => x.role === "assistant" && x.time.completed)
    if (!last) return ""
    const parts = sync.data.part[last.id] ?? []
    return parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join("\n")
      .slice(0, MAX_OUTPUT_CHARS)
  }

  /** Collect worker messages since a given timestamp.
   *  Returns concatenated text from all completed assistant messages after the timestamp. */
  function collectWorkerMessages(sessionID: string, sinceTimestamp: number): string {
    const msgs = sync.data.message[sessionID] ?? []
    const relevant = msgs.filter((m) => {
      if (m.role !== "assistant") return false
      if (!m.time.completed) return false
      return m.time.completed > sinceTimestamp
    })
    return relevant
      .flatMap((m) => sync.data.part[m.id] ?? [])
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join("\n")
      .slice(0, MAX_OUTPUT_CHARS)
  }

  /** Parse orchestrator directives from text output.
   *  Format: <worker1_[sessionID]>message</worker1_[sessionID]> */
  function parseOrchestratorDirectives(text: string): WorkerDirective[] {
    const directives: WorkerDirective[] = []
    const regex = /<worker\d+_([a-zA-Z0-9_-]+)>([\s\S]*?)<\/worker\d+_\1>/g
    let match
    while ((match = regex.exec(text)) !== null) {
      directives.push({
        workerId: match[1],
        message: match[2].trim(),
      })
    }
    return directives
  }

  /** Send message to a worker session.
   *  Verifies session exists before dispatch. Returns true on success. */
  async function sendToWorker(sessionID: string, text: string): Promise<boolean> {
    if (!sessionExists(sessionID)) {
      console.debug("AGI: worker session does not exist", { sessionID })
      return false
    }
    try {
      await sdk.client.session.promptAsync({
        sessionID,
        messageID: MessageID.ascending(),
        parts: [{ type: "text" as const, text }],
      })
      return true
    } catch (e) {
      console.debug("AGI: sendToWorker failed", { sessionID, error: e })
      return false
    }
  }

  /** Send context to orchestrator for analysis.
   *  No guards — status-driven dispatch only. */
  async function sendToOrchestrator(context: string): Promise<boolean> {
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
    } catch (e) {
      console.debug("AGI: sendToOrchestrator failed", { error: e })
      return false
    }
  }

  /**
   * Status-driven state machine.
   *
   * Phases:
   *   BOOTSTRAP → ORCH_BUSY → ORCH_DISPATCH → WORKERS_BUSY → WORKERS_COLLECT → ORCH_BUSY → ...
   *
   * Transitions driven by session_status signals only:
   *   orch busy→idle  → parse directives, dispatch to workers
   *   workers busy→idle → collect output, send to orchestrator
   *
   * Error handling:
   *   session.error event → deactivate, report error
   */
  let phase: LoopPhase = "BOOTSTRAP"
  let dispatchTime: Record<string, number> = {}
  let activeWorkers: string[] = []
  let unsubError: (() => void) | undefined

  createEffect(() => {
    if (!agiMode()) return

    const ob = orchBusy()
    const mb = mainBusy()

    switch (phase) {
      case "BOOTSTRAP":
        // Initial prompt already sent in toggleAgiMode — wait for orch to go busy
        if (ob) {
          phase = "ORCH_BUSY"
          console.debug("AGI: BOOTSTRAP → ORCH_BUSY")
        }
        break

      case "ORCH_BUSY":
        // Orchestrator finished processing → parse directives
        if (!ob) {
          refreshPlanStatus()

          // Check if all plans are done
          if (planData().active.length === 0) {
            const worktree = Global.Path.worktree || Global.Path.home

            if (evolvingMode()) {
              // Evolving mode: create improvement branch, instruct orchestrator
              const cycleNum = cycleCount() + 1
              setCycleCount(cycleNum)
              const branch = createImprovementBranch(worktree, cycleNum)
              if (branch) {
                toast.show({ message: `AGI: created improvement branch ${branch}`, variant: "info" })
              }

              const oid = orchSessionID()
              if (oid) {
                sendToOrchestrator([
                  "All active plans are complete.",
                  `EVOLVING MODE: Cycle ${cycleNum} — Enter evolving mode now.`,
                  "Analyze the codebase across Stability, Performance, Observability, Testing, and UX.",
                  "Propose 2-4 concrete improvement tasks per category.",
                  "Each task must include exact file paths, expected outcome, and verification criteria.",
                  "",
                  "IMPORTANT: After you propose tasks, WAIT for user acceptance/rejection.",
                  "Do NOT auto-execute — let the user decide which categories to pursue.",
                ].join("\n")).catch((e) => console.debug("evolving mode prompt failed", e))
                phase = "ORCH_BUSY"
              }
            }
            // No evolving mode — deactivate
            else {
              toast.show({ message: "AGI: all plans complete", variant: "success" })
              deactivate()
            }
            return
          }

          // Parse orchestrator output for worker directives
          const oid = orchSessionID()
          if (!oid) return
          const orchOutput = lastAssistantText(oid)
          const directives = parseOrchestratorDirectives(orchOutput)

          if (directives.length === 0) {
            // No directives — send continuation prompt
            console.debug("AGI: no directives found, sending continuation")
            sendToOrchestrator([
              `Plan progress: ${progressBar()}.`,
              `Active plans: ${planData().active.join(", ") || "none"}.`,
              "",
              "Your previous response did not contain worker directives.",
              "Produce EXACTLY ONE directive in this format:",
              `<worker1_[${mainSessionID()}]>YOUR INSTRUCTION</worker1_[${mainSessionID()}>`,
            ].join("\n")).catch((e) => console.debug("continuation prompt failed", e))
            phase = "ORCH_BUSY"
            return
          }

          // Dispatch to workers
          phase = "ORCH_DISPATCH"
          console.debug("AGI: ORCH_BUSY → ORCH_DISPATCH", { directives: directives.length })

          // Safety: max turns / max runtime
          const t = turnCount() + 1
          if (t > MAX_TURNS) {
            toast.show({ message: `AGI: max turns (${MAX_TURNS}) reached — deactivating`, variant: "info" })
            deactivate(true)
            return
          }

          const elapsed = Date.now() - activationStartedAt
          if (elapsed > MAX_RUNTIME_MS) {
            const hours = Math.round(elapsed / 3600000)
            toast.show({ message: `AGI: max runtime (${hours}h) reached — deactivating`, variant: "info" })
            deactivate(true)
            return
          }

          setTurnCount(t)

          // Dispatch directives to workers
          activeWorkers = directives.map((d) => d.workerId)
          dispatchTime = {}
          const now = Date.now()

          for (const directive of directives) {
            dispatchTime[directive.workerId] = now
            sendToWorker(directive.workerId, directive.message).then((ok) => {
              if (!ok) {
                toast.show({ message: `AGI: failed to dispatch to worker ${directive.workerId.slice(0, 8)}`, variant: "warning" })
              }
            })
          }

          // Transition to WORKERS_BUSY
          phase = "WORKERS_BUSY"
          console.debug("AGI: ORCH_DISPATCH → WORKERS_BUSY", { workers: activeWorkers })
        }
        break

      case "WORKERS_BUSY":
        // Check if all workers are idle
        const allIdle = activeWorkers.every((wid) => {
          const s = sync.data.session_status?.[wid] as { type: string } | undefined
          return !s || s.type === "idle" || s.type === "error"
        })

        if (allIdle) {
          phase = "WORKERS_COLLECT"
          console.debug("AGI: WORKERS_BUSY → WORKERS_COLLECT")
        }
        break

      case "WORKERS_COLLECT":
        // Collect output from all workers, send to orchestrator
        const workerData = activeWorkers
          .map((wid) => {
            const output = collectWorkerMessages(wid, dispatchTime[wid] ?? 0)
            return output ? `<data_from_worker_${wid}>${output}</data_from_worker_${wid}>` : ""
          })
          .filter(Boolean)
          .join("\n\n")

        const context = [
          `Turn ${turnCount()} complete. Plan progress: ${progressBar()}.`,
          workerData ? `Worker results:\n${workerData}` : "",
          "",
          "Analyze the results. What was accomplished? What's the next task?",
          `Produce EXACTLY ONE directive:`,
          `<worker1_[${mainSessionID()}]>next instruction</worker1_[${mainSessionID()}>`,
        ].filter(Boolean).join("\n\n")

        sendToOrchestrator(context).then((ok) => {
          if (!ok) {
            toast.show({ message: "AGI: failed to send results to orchestrator", variant: "warning" })
          }
        })

        // Clear dispatch state, transition back to ORCH_BUSY
        dispatchTime = {}
        activeWorkers = []
        phase = "ORCH_BUSY"
        console.debug("AGI: WORKERS_COLLECT → ORCH_BUSY")
        break
    }
  })

  /** Deactivate AGI mode — pause, don't destroy. */
  async function deactivate(silent = false) {
    // Unsubscribe from error events
    unsubError?.()
    unsubError = undefined

    // Reset phase
    phase = "BOOTSTRAP"
    dispatchTime = {}
    activeWorkers = []

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
    // Reset turn count on each activation
    setTurnCount(0)
    activationStartedAt = Date.now()
    // Show enabled badge immediately — before any async work.
    setAgiMode(true)

    try {
      // Git auto-init — ensure .git exists before orchestrator starts
      const worktree = Global.Path.worktree || Global.Path.home
      if (!ensureGitInit(worktree)) {
        toast.show({ message: "AGI: git init failed — continuing without git", variant: "warning" })
      }

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

      // Subscribe to session.error events for main and orchestrator sessions
      unsubError = event.on("session.error", (evt) => {
        const sid = evt.properties.sessionID
        if (!sid) return
        if (sid === orchSessionID() || sid === mainSessionID()) {
          const msg = errorMessage(evt.properties.error)
          toast.show({ message: `AGI: session error in ${sid.slice(0, 8)}: ${msg}`, variant: "error", duration: 8000 })
          deactivate(true)
        }
      })

      // Kick off orchestrator only on first activation — not on resume
      if (!existed) {
        const messageID = MessageID.ascending()
        const activePlans = planData().active.join(", ") || "none"
        const evolvingNote = evolvingMode()
          ? "\n\nIMPORTANT: Evolving mode is ENABLED. When all active plans complete, you MUST enter evolving mode as described in your instructions. Analyze the codebase across Stability, Performance, Observability, Testing, and UX categories."
          : ""
        await sdk.client.session.promptAsync({
          sessionID: oid,
          messageID,
          agent: "orchestrator",
          parts: [{
            type: "text" as const,
            text: [
              `Current state: ${progressBar()}. Active plans: ${activePlans}.`,
              `Completed: ${planData().completed.length}.`,
              evolvingNote,
              "",
              "BOOTSTRAP PHASE: Analyze the active plans. Read the dependency graph in the master plan.",
              "After analysis, produce your first task directive using this EXACT format:",
              "",
              `<worker1_[${mainSessionID()}]>YOUR INSTRUCTION TEXT HERE</worker1_[${mainSessionID()}>`,
              "",
              "Replace the placeholder with the actual session ID shown above.",
              "Focus on ONE actionable task. Be specific about files and expected outcomes.",
              "",
              "When you complete a task directive, I will execute it in the worker session",
              "and return results wrapped in <data_from_worker_*> tags for your analysis.",
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
              `Cycles completed: ${cycleCount()}.`,
              "",
              "Continue from where you left off. Produce your next directive:",
              `<worker1_[${mainSessionID()}]>next instruction</worker1_[${mainSessionID()}>`,
            ].join("\n"),
          }],
        })
      }

      // Set phase to BOOTSTRAP — wait for orchestrator to go busy
      phase = "BOOTSTRAP"
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
    } catch (e) { console.debug("orchestrator compact failed", e) }
  }

  /** Estimate cost based on token usage (approximate $/1M tokens). */
  function estimateCost(): string {
    const stats = orchStats()
    const inputTokens = stats.tokens
    const outputTokens = Math.ceil(inputTokens * 0.3) // rough estimate
    const cost = (inputTokens * 0.000003) + (outputTokens * 0.000015) // GPT-4 rates
    return `$${cost.toFixed(2)}`
  }

  /** Get full AGI status summary. */
  function getAgiStatus(): string {
    const stats = orchStats()
    return [
      `Turn: ${turnCount()}/${MAX_TURNS}`,
      `Cycle: ${cycleCount()}`,
      `Runtime: ${Math.round((Date.now() - activationStartedAt) / 60000)}m`,
      `Orchestrator: ${stats.messages} messages, ~${stats.tokens} tokens`,
      `Cost: ~${estimateCost()}`,
      `Plan: ${progressBar()}`,
    ].join(" | ")
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
    evolvingMode,
    setEvolvingMode,
    cycleCount,
    totalCost,
    estimateCost,
    getAgiStatus,
  }
}
