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
  if (n >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(1).replace(/\.0$/, "")
    return `${v}M`
  }
  if (n >= 1_000) {
    const v = (n / 1_000).toFixed(1).replace(/\.0$/, "")
    return `${v}k`
  }
  return n.toString()
}

function formatCacheStats(
  hitRate: number | null,
  read: number | null,
  miss: number | null,
  lastRead?: number | null,
  lastMiss?: number | null,
): string {
  if (hitRate === null && read === null) return "(null)"
  if (hitRate === null) return "cold"
  const r = lastRead != null ? `(${compactNum(lastRead)})` : ""
  const m = lastMiss != null ? `(${compactNum(lastMiss)})` : ""
  return `${hitRate}%(${compactNum(read ?? 0)}${r}hit ${compactNum(miss ?? 0)}${m}miss)`
}

function cacheTokens(message: AssistantMessage) {
  const hitRateIsNull = message.tokens.cache.hitRateIsNull
  if (hitRateIsNull === 1) return { read: null, miss: null }
  return { read: message.tokens.cache.read, miss: message.tokens.input }
}

/**
 * Session-level cumulative cache stats from the DB-backed session row
 * (tokens.input = full prompt incl. cached, tokens.cache.read = cached part) —
 * survives compaction, revert and restarts. Falls back to per-message sums
 * when the session object isn't loaded. Turns without cache stats ("unknown")
 * are already folded into the cumulative as full hits by the processor.
 */
function cumulativeStats(
  session:
    | {
        tokens?: { input?: number; cache?: { read?: number } }
      }
    | undefined,
  messages: AssistantMessage[],
): { cacheRead: number; cacheMiss: number; hitRate: number | null } {
  if (session?.tokens) {
    const read = session.tokens.cache?.read ?? 0
    const miss = Math.max(0, (session.tokens.input ?? 0) - read)
    const total = read + miss
    return {
      cacheRead: read,
      cacheMiss: miss,
      hitRate: total > 0 && read > 0 ? Math.round((read / total) * 100) : null,
    }
  }
  let cacheRead = 0
  let cacheMiss = 0
  for (const m of messages) {
    // hitRateIsNull=1 means provider didn't return stats — treated as full hit.
    if (m.tokens.cache.hitRateIsNull === 1) {
      cacheRead += m.tokens.input
    } else {
      cacheRead += m.tokens.cache.read ?? 0
      cacheMiss += m.tokens.input
    }
  }
  const total = cacheRead + cacheMiss
  return {
    cacheRead,
    cacheMiss,
    hitRate: total > 0 && cacheRead > 0 ? Math.round((cacheRead / total) * 100) : null,
  }
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

  // Get AGI mode sessions if active
  let agiMode: ReturnType<typeof useAgiMode> | undefined
  try {
    agiMode = useAgiMode(() => props.session_id)
  } catch {
    console.debug("sidebar: not in AGI context")
  }

  // Session-level cumulative cost (session.cost in the DB): incremented per
  // usage transactionally and never reset — survives compaction, revert and
  // restarts. Child (sub-agent) sessions are included; AGI (orchestrator /
  // main) sessions are separate — counted and displayed on their own.
  const cost = createMemo(() => {
    const agiExcluded = new Set(
      [agiMode?.orchSessionID(), agiMode?.mainSessionID()].filter((x): x is string => Boolean(x)),
    )
    return props.api.state.session
      .list()
      .filter((s) => (s.id === props.session_id || s.parentID === props.session_id) && !agiExcluded.has(s.id))
      .reduce((sum, s) => sum + (s.cost ?? 0), 0)
  })
  const [providerStatus, setProviderStatus] = createSignal<Record<string, ModelStatusDisplay>>({})

  // Calculate cache stats for all active sessions
  const allSessionStats = createMemo(() => {
    const stats: Array<{
      name: string
      cacheRead: number | null
      cacheMiss: number | null
      hitRate: number | null
      lastCacheRead: number | null
      lastCacheMiss: number | null
    }> = []

    const byId = Object.fromEntries(props.api.state.session.list().map((s) => [s.id, s]))

    // Current session stats — cumulative from the session row (DB-backed,
    // survives compaction/revert); last-turn values from the last message.
    const allAssistant = msg().filter(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    const last = allAssistant[allAssistant.length - 1]
    if (last) {
      const lvl = cumulativeStats(byId[props.session_id], allAssistant)
      const lastTokens = cacheTokens(last)
      stats.push({
        name: "in",
        cacheRead: lvl.cacheRead,
        cacheMiss: lvl.cacheMiss,
        hitRate: lvl.hitRate,
        lastCacheRead: lastTokens.read ?? null,
        lastCacheMiss: lastTokens.miss ?? null,
      })
    }

    // AGI mode sessions (orchestrator, main)
    if (agiMode) {
      const orchSid = agiMode.orchSessionID()
      const mainSid = agiMode.mainSessionID()
      if (orchSid && orchSid !== props.session_id) {
        const orchMsgs = props.api.state.session.messages(orchSid)
        const orchAssistant = orchMsgs.filter(
          (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
        )
        if (orchAssistant.length > 0) {
          const lvl = cumulativeStats(byId[orchSid], orchAssistant)
          const orchLast = orchAssistant[orchAssistant.length - 1]
          const orchLastTokens = cacheTokens(orchLast)
          stats.push({
            name: "orch",
            cacheRead: lvl.cacheRead,
            cacheMiss: lvl.cacheMiss,
            hitRate: lvl.hitRate,
            lastCacheRead: orchLastTokens.read ?? null,
            lastCacheMiss: orchLastTokens.miss ?? null,
          })
        }
      }
      if (mainSid && mainSid !== props.session_id) {
        const mainMsgs = props.api.state.session.messages(mainSid)
        const mainAssistant = mainMsgs.filter(
          (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
        )
        if (mainAssistant.length > 0) {
          const lvl = cumulativeStats(byId[mainSid], mainAssistant)
          const mainLast = mainAssistant[mainAssistant.length - 1]
          const mainLastTokens = cacheTokens(mainLast)
          stats.push({
            name: "main",
            cacheRead: lvl.cacheRead,
            cacheMiss: lvl.cacheMiss,
            hitRate: lvl.hitRate,
            lastCacheRead: mainLastTokens.read ?? null,
            lastCacheMiss: mainLastTokens.miss ?? null,
          })
        }
      }
    }

    // Active sub-agent sessions (children of current session). AGI sessions
    // are excluded — they are separate sessions with their own rows.
    const agiExcluded = new Set(
      [agiMode?.orchSessionID(), agiMode?.mainSessionID()].filter((x): x is string => Boolean(x)),
    )
    const childSessions = props.api.state.session.list().filter(
      (s) => s.parentID === props.session_id && !agiExcluded.has(s.id),
    )
    for (const child of childSessions) {
      const childMsgs = props.api.state.session.messages(child.id)
      const childAssistant = childMsgs.filter(
        (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
      )
      if (childAssistant.length > 0) {
        const lvl = cumulativeStats(child, childAssistant)
        const childLast = childAssistant[childAssistant.length - 1]
        const childLastTokens = cacheTokens(childLast)
        const label = child.title.split(" ")[0].toLowerCase() || child.id.slice(0, 6)
        stats.push({
          name: label,
          cacheRead: lvl.cacheRead,
          cacheMiss: lvl.cacheMiss,
          hitRate: lvl.hitRate,
          lastCacheRead: childLastTokens.read ?? null,
          lastCacheMiss: childLastTokens.miss ?? null,
        })
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
      getModelStatus(p.id)
        .then((status) => {
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
        })
        .catch((e) => console.debug("sidebar balance fetch failed", e))
    }
  })

  const state = createMemo(() => {
    const allAssistant = msg().filter(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
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
    const cacheHitRate =
      totalInput > 0 && last.tokens.cache.read > 0 ? Math.round((last.tokens.cache.read / totalInput) * 100) : null

    let sessionCacheRead = 0
    let sessionCacheInput = 0
    for (const m of allAssistant) {
      sessionCacheRead += m.tokens.cache.read
      sessionCacheInput += m.tokens.input
    }
    const sessionTotal = sessionCacheRead + sessionCacheInput
    const sessionCacheHitRate =
      sessionTotal > 0 && sessionCacheRead > 0 ? Math.round((sessionCacheRead / sessionTotal) * 100) : null

    return {
      tokens,
      percent: model?.limit?.context ? Math.round((tokens / model.limit.context) * 100) : null,
      gatewayEnabled,
      protocol: gatewayEnabled ? model?.options?.protocol || "http/1.1" : undefined,
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

  // Output side — lifetime totals (DB-backed, never reset) with last-turn
  // values in parens, mirroring the "in:" convention: cumulative(last).
  // msg = content output, think = reasoning (bare "R" prefix was unclear).
  const outputStats = createMemo(() => {
    const s = props.api.state.session.list().find((item) => item.id === props.session_id)
    const all = msg().filter((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    const last = all[all.length - 1]
    return {
      output: s?.tokens?.output ?? 0,
      reasoning: s?.tokens?.reasoning ?? 0,
      lastOutput: last?.tokens.output ?? 0,
      lastReasoning: last?.tokens.reasoning ?? 0,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Greeting</b>
      </text>
      {state().providerID ? (
        <text fg={theme().textMuted}>
          {state().providerID} · {state().apiProtocol}
          {state().protocol ? ` · ${state().protocol}` : ""}
        </text>
      ) : null}
      {state().streaming !== undefined ? (
        <text fg={theme().textMuted}>Streaming: {state().streaming ? "enabled" : "disabled"}</text>
      ) : null}
      {state().h2Sessions > 0 ? (
        <text fg={theme().textMuted}>Stream capacity: {state().h2Sessions * state().h2MaxConcurrentStreams}</text>
      ) : null}
      {state().activeStreams > 0 ? <text fg={theme().textMuted}>Active: {state().activeStreams}</text> : null}
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      {allSessionStats().length > 0 ? (
        allSessionStats().map((s) => (
          <text fg={(s.hitRate ?? 0) > 80 ? theme().success : (s.hitRate ?? 0) >= 40 ? theme().warning : theme().error}>
            {s.name}: {formatCacheStats(s.hitRate, s.cacheRead, s.cacheMiss, s.lastCacheRead, s.lastCacheMiss)}
          </text>
        ))
      ) : (
        <text fg={theme().textMuted}>Cache: cold</text>
      )}
      {(outputStats().output > 0 || outputStats().reasoning > 0) && (
        <text fg={theme().textMuted}>
          out: {compactNum(outputStats().output)}({compactNum(outputStats().lastOutput)})msg{" "}
          {compactNum(outputStats().reasoning)}({compactNum(outputStats().lastReasoning)})think
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
                <text
                  fg={w.usedPercent >= 90 ? theme().error : w.usedPercent >= 75 ? theme().warning : theme().textMuted}
                >
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
