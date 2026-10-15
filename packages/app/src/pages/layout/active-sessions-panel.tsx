import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Session, UserMessage } from "@opencode-ai/sdk/v2/client"
import { A } from "@solidjs/router"
import { type Accessor, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { sessionTitle } from "@/utils/session-title"
import { activeSessionRows, elapsedLabel } from "./active-sessions"

/**
 * Web "Active Sessions" block (t59 W2) — the browser twin of the TUI block
 * (`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/sessions.tsx`).
 *
 * Same source, same semantics: the `session` list + `session_status` map from
 * the child sync stores (fed by `session.list` / `session.status` + the global
 * event stream), agent/model from each session's last user message, an
 * in-memory `busySince` stamp map, and a 1 s tick that re-renders ELAPSED time
 * only — nothing polls. Idle/missing sessions are dropped; anything unrecognized
 * reads `unknown`; an empty block reads `none active` (never blank).
 */

const ELAPSED_TICK_MS = 1_000

/** Module-level so panel remounts do not reset a running clock mid-process. */
const busySince = new Map<string, number>()

function lastUserMessage(messages: readonly unknown[] | undefined) {
  if (!messages) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string }
    if (m?.role === "user") return messages[i] as UserMessage
  }
  return undefined
}

export function ActiveSessionsPanel(props: { directories: Accessor<string[]> }): JSX.Element {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ELAPSED_TICK_MS)
    onCleanup(() => clearInterval(timer))
  })

  const rows = createMemo(() => {
    tick()
    const sessions: Session[] = []
    const statusOf = (sessionID: string) => {
      for (const directory of props.directories()) {
        const [store] = globalSync.child(directory, { bootstrap: false })
        const status = store.session_status[sessionID]
        if (status) return status
      }
      return undefined
    }
    const metaOf = (sessionID: string) => {
      for (const directory of props.directories()) {
        const [store] = globalSync.child(directory, { bootstrap: false })
        const last = lastUserMessage(store.message[sessionID])
        if (!last) continue
        return {
          agent: last.agent,
          model: last.model ? `${last.model.providerID}/${last.model.modelID}` : undefined,
        }
      }
      return undefined
    }
    const directoryOf = (sessionID: string) => {
      for (const directory of props.directories()) {
        const [store] = globalSync.child(directory, { bootstrap: false })
        if (store.session.some((s) => s.id === sessionID)) return directory
      }
      return undefined
    }
    for (const directory of props.directories()) {
      const [store] = globalSync.child(directory, { bootstrap: false })
      for (const s of store.session) sessions.push(s)
    }
    const shaped = activeSessionRows({
      sessions,
      statusOf,
      metaOf,
      busySince,
      now: Date.now(),
    })
    return shaped.map((row) => ({ ...row, directory: directoryOf(row.sessionID) }))
  })

  return (
    <div data-component="active-sessions" class="shrink-0 px-1 py-1">
      <div class="flex items-center gap-2 px-2">
        <span class="text-13-medium text-text-strong">{language.t("sidebar.activeSessions.title")}</span>
        <Show when={rows().length > 0}>
          <span class="text-12-regular text-text-base">({rows().length})</span>
        </Show>
      </div>
      <Show
        when={rows().length > 0}
        fallback={<div class="px-2 py-0.5 text-13-regular text-text-base">{language.t("sidebar.activeSessions.none")}</div>}
      >
        <For each={rows()}>
          {(row) => (
            <Show
              when={row.directory}
              fallback={
                <div class="px-2 py-0.5">
                  <ActiveRowTitle row={row} />
                  <ActiveRowMeta row={row} />
                </div>
              }
            >
              {(directory) => (
                <A
                  href={`/${base64Encode(directory())}/session/${row.sessionID}`}
                  class="block rounded-md px-2 py-0.5 hover:bg-surface-raised-base-hover"
                >
                  <ActiveRowTitle row={row} />
                  <ActiveRowMeta row={row} />
                </A>
              )}
            </Show>
          )}
        </For>
      </Show>
    </div>
  )
}

function ActiveRowTitle(props: { row: { title: string; elapsedMs: number } }) {
  const title = () => sessionTitle(props.row.title) ?? props.row.title
  return (
    <div class="flex items-center justify-between gap-2">
      <span class="text-13-regular text-text-strong min-w-0 flex-1 truncate">{title()}</span>
      <span class="text-12-regular text-text-base shrink-0">{elapsedLabel(props.row.elapsedMs)}</span>
    </div>
  )
}

function ActiveRowMeta(props: {
  row: { agent: string; model: string; state: string; attempt?: number; shortID: string }
}) {
  return (
    <div class="text-12-regular text-text-base truncate">
      {props.row.agent} · {props.row.model} · {props.row.state}
      {props.row.attempt ? ` #${props.row.attempt}` : ""} · {props.row.shortID}
    </div>
  )
}
