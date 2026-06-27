import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { getModelStatus } from "@/provider/balance"
import { useAgiMode } from "@tui/context/agi-mode"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

/** Compact number formatter — max 3 digits + symbol (e.g., 8M, 137k, 50k). */
function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).slice(0, 4)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).slice(0, 4)}k`
  return n.toString()
}

/** Format cache stats in compact form: 99%(161K read 860 miss). */
function formatCacheStats(hitRate: number | null, read: number, miss: number): string {
  if (hitRate === null) return "cold"
  return `${hitRate}%(${compactNum(read)} read ${compactNum(miss)} miss)`
}

interface ModelStatusDisplay {
  type: "balance" | "usage" | "unavailable"
  currency?: string
  totalBalance?: string
  isAvailable?: boolean
  windows?: Array<{ label: string; usedPercent: number; resetAt: number }>
  reason?: string
  timestamp: number
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => {
    let total = msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    // Include sub-agent session costs
    const allSessions = props.api.state.session.list()
    const childSessions = allSessions.filter((s) => s.parentID === props.session_id)
    for (const child of childSessions) {
      const childMsgs = props.api.state.session.messages(child.id)
      total += childMsgs.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    }
    return total
  })
  const [providerStatus, setProviderStatus] = createSignal<Record<string, ModelStatusDisplay>>({})

  // Get AGI mode sessions if active
  let agiMode: ReturnType<typeof useAgiMode> | undefined
  try {
    agiMode = useAgiMode(() => props.session_id)
  } catch {
    // Not in AGI context
  }

  // Calculate cache stats for all active sessions
  const allSessionStats = createMemo(() => {
    const stats: Array<{ name: string; cacheRead: number; cacheMiss: number; hitRate: number | null }> = []

    // Current session stats
    const allAssistant = msg().filter((item): item is AssistantMessage =>
      item.role === "assistant" && item.tokens.output > 0,
    )
    const last = allAssistant[allAssistant.length - 1]
    if (last) {
      let sessionCacheRead = 0
      let sessionCacheMiss = 0
      for (const m of allAssistant) {
        sessionCacheRead += m.tokens.cache.read
        sessionCacheMiss += m.tokens.input
      }
      const total = sessionCacheRead + sessionCacheMiss
      const hitRate = total > 0 && sessionCacheRead > 0
        ? Math.round((sessionCacheRead / total) * 100)
        : null
      stats.push({
        name: "current",
        cacheRead: sessionCacheRead,
        cacheMiss: sessionCacheMiss,
        hitRate,
      })
    }

    // AGI mode sessions (orchestrator, main)
    if (agiMode) {
      const orchSid = agiMode.orchSessionID()
      const mainSid = agiMode.mainSessionID()
      if (orchSid && orchSid !== props.session_id) {
        const orchMsgs = props.api.state.session.messages(orchSid)
        const orchAssistant = orchMsgs.filter((m): m is AssistantMessage =>
          m.role === "assistant" && m.tokens.output > 0,
        )
        if (orchAssistant.length > 0) {
          let cacheRead = 0
          let cacheMiss = 0
          for (const m of orchAssistant) {
            cacheRead += m.tokens.cache.read
            cacheMiss += m.tokens.input
          }
          const total = cacheRead + cacheMiss
          const hitRate = total > 0 && cacheRead > 0
            ? Math.round((cacheRead / total) * 100)
            : null
          stats.push({ name: "orch", cacheRead, cacheMiss, hitRate })
        }
      }
      if (mainSid && mainSid !== props.session_id) {
        const mainMsgs = props.api.state.session.messages(mainSid)
        const mainAssistant = mainMsgs.filter((m): m is AssistantMessage =>
          m.role === "assistant" && m.tokens.output > 0,
        )
        if (mainAssistant.length > 0) {
          let cacheRead = 0
          let cacheMiss = 0
          for (const m of mainAssistant) {
            cacheRead += m.tokens.cache.read
            cacheMiss += m.tokens.input
          }
          const total = cacheRead + cacheMiss
          const hitRate = total > 0 && cacheRead > 0
            ? Math.round((cacheRead / total) * 100)
            : null
          stats.push({ name: "main", cacheRead, cacheMiss, hitRate })
        }
      }
    }

    // Active sub-agent sessions (children of current session)
    const allSessions = props.api.state.session.list()
    const childSessions = allSessions.filter((s) => s.parentID === props.session_id)
    for (const child of childSessions) {
      const childMsgs = props.api.state.session.messages(child.id)
      const childAssistant = childMsgs.filter((m): m is AssistantMessage =>
        m.role === "assistant" && m.tokens.output > 0,
      )
      if (childAssistant.length > 0) {
        let cacheRead = 0
        let cacheMiss = 0
        for (const m of childAssistant) {
          cacheRead += m.tokens.cache.read
          cacheMiss += m.tokens.input
        }
        const total = cacheRead + cacheMiss
        const hitRate = total > 0 && cacheRead > 0
          ? Math.round((cacheRead / total) * 100)
          : null
        // Use first word of title as label (e.g., "Explorer", "Coder")
        const label = child.title.split(" ")[0].toLowerCase() || child.id.slice(0, 6)
        stats.push({ name: label, cacheRead, cacheMiss, hitRate })
      }
    }

    return stats
  })

  // Listen for standardised model status updates — all providers
  const unsub = (props.api.event as any).on("session.model_status_updated", (evt: any) => {
    const p = evt.properties ?? evt
    setProviderStatus((prev) => ({
      ...prev,
      [p.providerID]: {
        type: p.type,
        currency: p.currency,
        totalBalance: p.totalBalance,
        isAvailable: p.isAvailable,
        windows: p.windows,
        reason: p.reason,
        timestamp: Date.now(),
      },
    }))
  })
  onCleanup(() => unsub?.())

  // Fetch model status for all configured providers on mount so the
  // sidebar shows status immediately, not just after a message is sent.
  onMount(() => {
    for (const p of props.api.state.provider) {
      getModelStatus(p.id).then((status) => {
        setProviderStatus((prev) => ({
          ...prev,
          [p.id]: {
            type: status.type,
            currency: (status as any).currency,
            totalBalance: (status as any).totalBalance,
            isAvailable: (status as any).isAvailable,
            windows: (status as any).windows,
            reason: (status as any).reason,
            timestamp: Date.now(),
          },
        }))
      }).catch((e) => console.debug("sidebar balance fetch failed", e))
    }
  })

  const state = createMemo(() => {
    const allAssistant = msg().filter((item): item is AssistantMessage =>
      item.role === "assistant" && item.tokens.output > 0,
    )
    const last = allAssistant[allAssistant.length - 1]
    if (!last) {
      return {
        tokens: 0,
        percent: null,
        protocol: undefined as string | undefined,
        streaming: undefined as boolean | undefined,
        activeStreams: 0 as number,
        h2Sessions: 0 as number,
        gatewayEnabled: false,
        cacheRead: 0 as number,
        cacheInput: 0 as number,
        cacheHitRate: null as number | null,
        sessionCacheRead: 0 as number,
        sessionCacheInput: 0 as number,
        sessionCacheHitRate: null as number | null,
        reasoning: 0 as number,
        h2MaxConcurrentStreams: 0 as number,
        output: 0 as number,
        outputLimit: 0 as number,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const provider = props.api.state.provider.find((item) => item.id === last.providerID) as any
    const model = provider?.models[last.modelID] as any
    const gatewayEnabled = model?.gateway?.enabled !== false && provider?.gateway?.enabled !== false
    const outputLimit = (model?.limit?.output as number | undefined) ?? 0

    const liveStatus = (globalThis as any).__gatewayLiveStatus as
      | { activeStreams: number; h2Sessions: number; h2MaxConcurrentStreams: number; updatedAt: number }
      | undefined

    const totalInput = last.tokens.input + last.tokens.cache.read
    const cacheHitRate = totalInput > 0 && last.tokens.cache.read > 0
      ? Math.round((last.tokens.cache.read / totalInput) * 100)
      : null

    // Cumulative session cache: sum across ALL assistant messages
    let sessionCacheRead = 0
    let sessionCacheInput = 0
    for (const m of allAssistant) {
      sessionCacheRead += m.tokens.cache.read
      sessionCacheInput += m.tokens.input
    }
    const sessionTotal = sessionCacheRead + sessionCacheInput
    const sessionCacheHitRate = sessionTotal > 0 && sessionCacheRead > 0
      ? Math.round((sessionCacheRead / sessionTotal) * 100)
      : null

    return {
      tokens,
      percent: model?.limit?.context ? Math.round((tokens / model.limit.context) * 100) : null,
      gatewayEnabled,
      protocol: gatewayEnabled ? (model?.options?.protocol || "http/1.1") : undefined,
      streaming: gatewayEnabled ? (model?.options?.streaming ?? true) : undefined,
      activeStreams: liveStatus?.activeStreams ?? 0,
      h2Sessions: liveStatus?.h2Sessions ?? 0,
      h2MaxConcurrentStreams: liveStatus?.h2MaxConcurrentStreams ?? 0,
      cacheRead: last.tokens.cache.read,
      cacheInput: last.tokens.input,
      cacheHitRate,
      sessionCacheRead,
      sessionCacheInput,
      sessionCacheHitRate,
      reasoning: last.tokens.reasoning,
      output: last.tokens.output,
      outputLimit,
      providerID: last.providerID,
      apiProtocol: (model?.api?.npm as string)?.includes("anthropic") ? "Anthropic" : "OpenAI",
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Greeting</b>
      </text>
      {state().providerID ? <text fg={theme().textMuted}>{state().providerID} · {state().apiProtocol}{state().protocol ? ` · ${state().protocol}` : ""}</text> : null}
      {state().streaming !== undefined ? (
        <text fg={theme().textMuted}>Streaming: {state().streaming ? "enabled" : "disabled"}</text>
      ) : null}
      {state().h2Sessions > 0 ? <text fg={theme().textMuted}>Stream capacity: {state().h2Sessions * state().h2MaxConcurrentStreams}</text> : null}
      {state().activeStreams > 0 ? <text fg={theme().textMuted}>Active: {state().activeStreams}</text> : null}
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      {allSessionStats().length > 0 ? (
        allSessionStats().map((s) => (
          <text fg={(s.hitRate ?? 0) > 80 ? theme().success : (s.hitRate ?? 0) >= 40 ? theme().warning : theme().error}>
            {s.name}: {formatCacheStats(s.hitRate, s.cacheRead, s.cacheMiss)}
          </text>
        ))
      ) : (
        <text fg={theme().textMuted}>Cache: cold</text>
      )}
      {(state().reasoning > 0 || state().output > 0) && (
        <text fg={theme().textMuted}>
          Output: {state().reasoning > 0 ? `R${compactNum(state().reasoning)}, ` : ""}{compactNum(state().output)}{state().outputLimit > 0 ? `/${compactNum(state().outputLimit)}` : ""} tok
        </text>
      )}
      {cost() > 0 && <text fg={theme().textMuted}>{money.format(cost())} spent</text>}
      {(() => {
        const pid = state().providerID
        if (!pid) return null
        const status = providerStatus()[pid]
        if (!status) {
          return (
            <box marginTop={1}>
              <text fg={theme().text}>
                <b>Status</b>
              </text>
              <text fg={theme().textMuted}>No Status</text>
            </box>
          )
        }
        if (status.type === "balance") {
          return (
            <box marginTop={1}>
              <text fg={theme().text}>
                <b>Status</b>
              </text>
              <text fg={status.isAvailable ? theme().success : theme().error}>
                {status.isAvailable ? "✓ available" : "✗ insufficient"}
              </text>
              <text fg={theme().textMuted}>
                {Number(status.totalBalance).toFixed(2)} {status.currency}
              </text>
            </box>
          )
        }
        if (status.type === "usage") {
          return (
            <box marginTop={1}>
              <text fg={theme().text}>
                <b>Status</b>
              </text>
              {(status.windows ?? []).map((w) => (
                <text fg={w.usedPercent >= 90 ? theme().error : w.usedPercent >= 75 ? theme().warning : theme().textMuted}>
                  {w.label}: {w.usedPercent}% used
                </text>
              ))}
            </box>
          )
        }
        return (
          <box marginTop={1}>
            <text fg={theme().text}>
              <b>Status</b>
            </text>
            <text fg={theme().textMuted}>No Status</text>
          </box>
        )
      })()}
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
