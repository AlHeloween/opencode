import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
        protocol: undefined as string | undefined,
        streaming: undefined as boolean | undefined,
        activeStreams: 0 as number,
        h2Sessions: 0 as number,
        h2MaxConcurrentStreams: 0 as number,
        gatewayEnabled: false,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const provider = props.api.state.provider.find((item) => item.id === last.providerID) as any
    const model = provider?.models[last.modelID] as any
    const gatewayEnabled = model?.gateway?.enabled !== false && provider?.gateway?.enabled !== false

    const liveStatus = (globalThis as any).__gatewayLiveStatus as
      | { activeStreams: number; h2Sessions: number; h2MaxConcurrentStreams: number; updatedAt: number }
      | undefined

    return {
      tokens,
      percent: model?.limit?.context ? Math.round((tokens / model.limit.context) * 100) : null,
      gatewayEnabled,
      protocol: gatewayEnabled ? model?.gateway?.protocol || "http/1.1" : undefined,
      streaming: gatewayEnabled ? true : undefined,
      activeStreams: liveStatus?.activeStreams ?? 0,
      h2Sessions: liveStatus?.h2Sessions ?? 0,
      h2MaxConcurrentStreams: liveStatus?.h2MaxConcurrentStreams ?? 0,
      streamCapacity: (liveStatus?.h2Sessions ?? 0) * (liveStatus?.h2MaxConcurrentStreams ?? 100),
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Greeting</b>
      </text>
      {state().protocol ? <text fg={theme().textMuted}>Protocol: {state().protocol}</text> : null}
      {state().streaming !== undefined ? (
        <text fg={theme().textMuted}>Streaming: {state().streaming ? "enabled" : "disabled"}</text>
      ) : null}
      {state().gatewayEnabled ? <text fg={theme().textMuted}>Stream capacity: {state().streamCapacity}</text> : null}
      {state().activeStreams > 0 ? <text fg={theme().textMuted}>Active: {state().activeStreams}</text> : null}
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
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
