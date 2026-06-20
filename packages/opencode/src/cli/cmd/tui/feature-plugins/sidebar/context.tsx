import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const fmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

interface BalanceInfo {
  totalBalance: string
  currency: string
  isAvailable: boolean
  timestamp: number
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))
  const [balance, setBalance] = createSignal<BalanceInfo | null>(null)

  // Listen for balance update events from the backend
  const unsub = (props.api.event as any).on("session.balance_updated", (evt: any) => {
    const props = evt.properties ?? evt
    if (props.providerID !== "deepseek") return
    setBalance({
      totalBalance: props.totalBalance,
      currency: props.currency,
      isAvailable: props.isAvailable,
      timestamp: Date.now(),
    })
  })
  onCleanup(() => unsub?.())

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
      {state().cacheRead > 0 ? (
        <text fg={state().cacheHitRate! > 80 ? theme().success : state().cacheHitRate! >= 40 ? theme().warning : theme().error}>
          Cache: {state().cacheHitRate}% hit ({fmt.format(state().cacheRead)} read · {fmt.format(state().cacheInput)} miss)
        </text>
      ) : state().cacheInput > 0 ? (
        <text fg={theme().textMuted}>Cache: cold (no cached tokens)</text>
      ) : null}
      {state().sessionCacheRead! > 0 && state().sessionCacheHitRate !== null && state().sessionCacheHitRate !== state().cacheHitRate ? (
        <text fg={state().sessionCacheHitRate! > 80 ? theme().success : state().sessionCacheHitRate! >= 40 ? theme().warning : theme().error}>
          Session: {state().sessionCacheHitRate}% ({fmt.format(state().sessionCacheRead!)} read · {fmt.format(state().sessionCacheInput!)} miss)
        </text>
      ) : null}
      {state().reasoning > 0 && (
        <text fg={theme().textMuted}>Reasoning: {state().reasoning.toLocaleString()} tokens</text>
      )}
      {state().output > 0 && (
        <text fg={theme().textMuted}>
          Output: {state().output.toLocaleString()}
          {state().outputLimit > 0 ? ` / ${state().outputLimit.toLocaleString()} tokens` : " tokens"}
        </text>
      )}
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      {balance() && (
        <box marginTop={1}>
          <text fg={theme().text}>
            <b>Balance</b>
          </text>
          <text fg={balance()!.isAvailable ? theme().success : theme().error}>
            {balance()!.isAvailable ? "✓ available" : "✗ insufficient"}
          </text>
          <text fg={theme().textMuted}>
            {Number(balance()!.totalBalance).toFixed(2)} {balance()!.currency}
          </text>
        </box>
      )}
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
