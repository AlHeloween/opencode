import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { activeSessionRows, elapsedLabel, type SessionMeta } from "./active-sessions"

const id = "internal:sidebar-sessions"

/**
 * Wall-clock cadence for the ELAPSED column only — the data itself is
 * event-synced (`session` list + `session_status`, context/sync.tsx:623-626,
 * 964-966). Same pattern as the sidebar's cache stats sample
 * (`context.tsx:30,269-277`): the tick re-renders; nothing polls.
 */
const ELAPSED_TICK_MS = 1_000

/** In-memory UI state (no file — AGENTS.md § Storage Paradigm): first non-idle
 * sighting stamps the clock, idle deletes. Module-level so route remounts and
 * sidebar toggles do not reset a running clock mid-process. */
const busySince = new Map<string, number>()

export function SessionsView(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ELAPSED_TICK_MS)
    onCleanup(() => clearInterval(timer))
  })

  const rows = createMemo(() => {
    tick()
    return activeSessionRows({
      sessions: props.api.state.session.list(),
      statusOf: (sessionID) =>
        props.api.state.session.status(sessionID) as { type: string; attempt?: number } | undefined,
      metaOf: (sessionID): SessionMeta | undefined => {
        // The runtime payload carries more status variants than the v2 src-gen
        // type knows (see prompt/index.tsx:1557) — same narrow cast here.
        const last = props.api.state.session
          .messages(sessionID)
          .findLast((m): m is UserMessage => m.role === "user")
        if (!last) return undefined
        return {
          agent: last.agent,
          model: last.model ? `${last.model.providerID}/${last.model.modelID}` : undefined,
        }
      },
      busySince,
      now: Date.now(),
    })
  })

  const stateColor = (state: string) => {
    if (state === "working") return theme().accent
    if (state === "retrying") return theme().warning
    return theme().textMuted
  }

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text}>
          <b>Active Sessions</b>
        </text>
        <Show when={rows().length > 0}>
          <text fg={theme().textMuted}>({rows().length})</text>
        </Show>
      </box>
      <Show when={rows().length > 0} fallback={<text fg={theme().textMuted}>none active</text>}>
        <For each={rows()}>
          {(row) => (
            <box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={stateColor(row.state)} wrapMode="none">
                  {row.glyph} {Locale.truncate(row.title, 24)}
                </text>
                <text fg={theme().textMuted}>{elapsedLabel(row.elapsedMs)}</text>
              </box>
              <text fg={theme().textMuted} wrapMode="none">
                {row.agent} · {row.model} · {row.state}
                {row.attempt ? ` #${row.attempt}` : ""} · {row.shortID}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // Above the context block (100) so a running robot is the first thing seen.
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return <SessionsView api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
