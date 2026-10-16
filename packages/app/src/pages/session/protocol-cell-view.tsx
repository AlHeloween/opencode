import { type Accessor, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from '@/context/global-sdk'
import { useSync } from "@/context/sync"
import { acceptProtocolFact, type LastProtocol } from "../layout/protocol-facts"
import { describeProtocolCell, protocolCurrentFromMessages } from "./protocol-cell"

/**
 * Session-scoped protocol cell (t59 W3) — the web twin of the TUI sidebar
 * protocol cell (`sidebar/protocol-row.ts` + `sidebar/context.tsx:384-414`).
 *
 * Same bus event, no new server route: subscribes the GLOBAL emitter
 * (`useGlobalSDK().event.on("global", …)` — a directory-scoped `useSDK()`
 * never sees `"global"` events) for `gateway.protocol.selected`, validates
 * the untyped payload at the boundary, and correlates it to this session's
 * last assistant turn. Always a value, never blank (`⇅ auto(unknown)` with no
 * turn yet). No living-connection badge: its source is server-process-local
 * (see `./protocol-cell.ts`).
 */

const MAX_FACTS = 128

export function ProtocolCell(props: { sessionID: Accessor<string | undefined> }): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sync = useSync()
  const [facts, setFacts] = createStore<Record<string, LastProtocol>>({})

  const unsub = globalSDK.event.on("global", (event) => {
    const payload = (event as { type?: string; properties?: unknown }).type === "gateway.protocol.selected"
      ? (event as { properties?: unknown }).properties ?? event
      : undefined
    if (payload === undefined) return
    const fact = acceptProtocolFact(payload)
    if (!fact) return
    const pruned = Object.fromEntries(Object.entries(facts).slice(-(MAX_FACTS - 1)))
    if (!facts[fact.requestID] && Object.keys(pruned).length >= MAX_FACTS) return
    setFacts({ ...pruned, [fact.requestID]: fact })
  })
  onCleanup(unsub)

  const label = createMemo(() => {
    const id = props.sessionID()
    const current = id ? protocolCurrentFromMessages(id, sync.data.message[id]) : undefined
    return describeProtocolCell({ facts, current, configured: undefined }).label
  })

  return (
    <span data-component="protocol-cell" class="text-12-regular text-text-base whitespace-nowrap" title={label()}>
      {label()}
    </span>
  )
}
