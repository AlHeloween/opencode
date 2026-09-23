/**
 * /automode — bounded auto-continuation for the ACTIVE session.
 *
 * Owner's contract (2026-09-23, second revision):
 *   /automode      → continues while a plan is still in `plans/`; the mode ENDS when a plan LEAVES
 *                    `plans/` (moved to plans_completed or plans_deferred) — the MOVE is the exit;
 *   /automode all  → ends only when EVERY plan has been moved (`plans/` is empty);
 *   /automode N    → ends on the iteration counter alone.
 * Plan state comes from `getPlanStatus(worktree)` — the same placement tooling the orchestrator uses
 * for hanging plans, not a private directory scan.
 *
 * An OVERLAY on build_mode (owner, 2026-09-23) — the same agent identity and rules; it adds only
 * the continuation loop, never a new mode. While enabled, it watches the active session's
 * `session_status`: on each idle moment it
 * asks `autoModeDecision` (pure logic in automode-logic.ts) whether to send one more `continue` or to
 * exit. Additional exits: session `error`, the 24 h runtime cap, a failed `continue`, manual toggle.
 *
 * One service instance for the whole TUI (module-level, like the AGI mode): the command, the prompt
 * dispatcher and the status indicator must share ONE state.
 */
import { createSignal, createEffect, untrack } from "solid-js"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { useToast } from "../ui/toast"
import { Global } from "@opencode-ai/core/global"
import { getPlanStatus } from "@/util/plan-status"
import { MessageID } from "@/session/schema"
import { autoModeDecision, parseAutoModeArgs, type AutoModeKind } from "./automode-logic"

/** Module-level state — one instance for every useAutoMode() call site. */
const [autoMode, setAutoMode] = createSignal(false)
const [autoKind, setAutoKind] = createSignal<AutoModeKind>("current")
const [autoLimit, setAutoLimit] = createSignal<number | null>(null)
const [autoIteration, setAutoIteration] = createSignal(0)

/** 24 h runtime cap — the same guard AGI mode carries. */
const MAX_RUNTIME_MS = 24 * 60 * 60 * 1000

export type AutoModeApi = {
  autoMode: () => boolean
  autoKind: () => AutoModeKind
  autoLimit: () => number | null
  autoIteration: () => number
  handleSlash: (raw: string) => void
  stop: (reason: string) => void
}

let service: AutoModeApi | undefined

export function useAutoMode(currentSessionID: () => string | undefined): AutoModeApi {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  if (service) return service

  let startedAt = 0
  let waitingBusy = false
  let plansAtStart = 0

  function worktree(): string {
    return Global.Path.worktree || Global.Path.home
  }

  function statusType(sid: string): string | undefined {
    return (sync.data.session_status?.[sid] as { type?: string } | undefined)?.type
  }

  function activePlans(): number {
    return getPlanStatus(worktree()).active.length
  }

  /** Turn the mode off with one toast. The label disappears with the signal. */
  function stop(reason: string) {
    if (!autoMode()) return
    setAutoMode(false)
    setAutoLimit(null)
    waitingBusy = false
    toast.show({ message: `AUTO: ${reason} — mode off`, variant: "info" })
  }

  /** One `continue` for the watched session. */
  async function continueOnce(sid: string) {
    waitingBusy = true
    try {
      const result = await sdk.client.session.promptAsync({
        sessionID: sid,
        messageID: MessageID.ascending(),
        parts: [{ type: "text" as const, text: "continue" }],
      })
      if ("error" in result && result.error) {
        console.debug("AUTO: continue rejected", result.error)
        stop("continue failed")
      }
    } catch (e) {
      console.debug("AUTO: continue failed", e)
      stop("continue failed")
    }
  }

  /** One idle moment, one decision — the numbers come from the pure logic module. */
  function decide(sid: string) {
    const decision = autoModeDecision({
      kind: autoKind(),
      iteration: autoIteration(),
      limit: autoLimit(),
      plansAtStart,
      plansNow: activePlans(),
    })
    if (decision.action === "stop") {
      const text =
        decision.reason === "plan-moved"
          ? "plan moved out of plans/"
          : decision.reason === "plans-complete"
            ? "every plan moved (plans/ empty)"
            : `iteration limit (${autoLimit()}) reached`
      stop(text)
      return
    }
    setAutoIteration(autoIteration() + 1)
    void continueOnce(sid)
  }

  // THE watcher for the module, created by the first component that uses the hook (app.tsx).
  createEffect(() => {
    const sid = currentSessionID()
    const type = sid ? statusType(sid) : undefined
    const enabled = autoMode()
    if (!enabled || !sid) return
    untrack(() => {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        stop("max runtime (24h) reached")
        return
      }
      if (type === "error") {
        stop("session error")
        return
      }
      if (type === "busy" || type === "compacting") {
        waitingBusy = false
        return
      }
      // A missing or unknown status means «still starting», not idle.
      if (type !== "idle") return
      // Already sent one continue and the session has not gone busy yet — no second dispatch.
      if (waitingBusy) return
      decide(sid)
    })
  })

  /**
   * `/automode`, `/automode all`, `/automode N` — toggles the mode. Called by the prompt dispatcher
   * with the raw argument string.
   */
  function handleSlash(raw: string) {
    if (autoMode()) {
      stop("toggled off")
      return
    }
    const parsed = parseAutoModeArgs(raw)
    if (!parsed.ok) {
      toast.show({ message: `AUTO: ${parsed.error}`, variant: "warning" })
      return
    }
    const sid = currentSessionID()
    if (!sid) {
      toast.show({ message: "AUTO: no active session", variant: "warning" })
      return
    }
    const plans = activePlans()
    if (parsed.kind !== "iterations" && plans === 0) {
      toast.show({
        message: parsed.kind === "all" ? "AUTO: plans/ is already empty" : "AUTO: no plans in plans/",
        variant: "warning",
      })
      return
    }
    startedAt = Date.now()
    waitingBusy = false
    plansAtStart = plans
    setAutoKind(parsed.kind)
    setAutoLimit(parsed.limit)
    setAutoIteration(0)
    setAutoMode(true)
    toast.show({
      message:
        parsed.kind === "iterations"
          ? `AUTO: enabled — ${parsed.limit} iteration(s)`
          : parsed.kind === "all"
            ? "AUTO: enabled — waits for every plan to move"
            : "AUTO: enabled — exits when a plan moves out of plans/",
      variant: "success",
    })
  }

  const api: AutoModeApi = { autoMode, autoKind, autoLimit, autoIteration, handleSlash, stop }
  service = api
  return api
}
