/**
 * Pure protocol-row computation for the web sidebar (t59 W3, first slice).
 *
 * Ported from the TUI block
 * (`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/protocol-row.ts`
 * + the event guard in `sidebar/context.tsx:297-312`): same rung vocabulary,
 * same "never blank" invariant, same fact-selection rule.
 *
 * Source WITHOUT a new server route: the `gateway.protocol.selected` bus event
 * (`packages/opencode/src/provider/gateway/adaptive-client.ts:958-976`,
 * `directory: "global"`) rides the same `GET /global/event` SSE the web app
 * already consumes. It is untyped on the bus (the TUI subscribes with
 * `as any`), so the payload is validated at the boundary here
 * (`acceptProtocolFact`) before it ever reaches the row math. Subscribe on the
 * GLOBAL emitter (`useGlobalSDK().event.on("global", …)`) — a directory-scoped
 * `useSDK().event` never sees `"global"` events (`global-sdk.tsx:92`,
 * `sdk.tsx:27`).
 */

export type LastProtocol = {
  requestID: string
  providerID: string
  modelID: string
  protocol: string
  pinned?: string | null
  at: number
}

export type ProtocolCurrent = {
  requestID: string
  sessionID: string
  providerID: string
  modelID: string
  assistantCreatedAt: number
}

/** The rungs the sidebar may name. Anything else is a policy, not a measured transport. */
const RUNGS = ["h3", "h2", "http/1.1"]

const TRANSPORT_GLYPH = "⇅"

/**
 * Boundary guard for the untyped bus payload. Returns the fact when it can
 * answer, `undefined` when it cannot — a payload that cannot answer never
 * reaches the row math.
 */
export function acceptProtocolFact(payload: unknown): LastProtocol | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const p = payload as Record<string, unknown>
  if (typeof p["requestID"] !== "string" || !p["requestID"]) return undefined
  if (typeof p["providerID"] !== "string") return undefined
  if (typeof p["modelID"] !== "string") return undefined
  if (typeof p["at"] !== "number") return undefined
  if (typeof p["protocol"] !== "string" || !RUNGS.includes(p["protocol"])) return undefined
  const pinned = p["pinned"]
  return {
    requestID: p["requestID"],
    providerID: p["providerID"],
    modelID: p["modelID"],
    protocol: p["protocol"],
    pinned: typeof pinned === "string" ? pinned : null,
    at: p["at"],
  }
}

/**
 * The ONE fact that answers for the current assistant turn. Rung and pin come
 * from the same request, so they can never disagree.
 */
function pickFact(facts: Record<string, LastProtocol>, current: ProtocolCurrent): LastProtocol | undefined {
  const fact = facts[current.requestID] ?? (current.providerID === "novita-ai" ? facts[current.sessionID] : undefined)
  if (fact?.providerID !== current.providerID || fact.modelID !== current.modelID) return undefined
  if (fact.at < current.assistantCreatedAt) return undefined
  return fact
}

export function protocolRow(facts: Record<string, LastProtocol>, current: ProtocolCurrent): string {
  const fact = pickFact(facts, current)
  if (!fact) return "unknown"
  return RUNGS.includes(fact.protocol) ? fact.protocol : "unknown"
}

/**
 * The rung the route is PINNED to, for the same turn. Present only when the
 * request ran on an `auto` route whose outcome the runtime wrote into the
 * persistent route store.
 */
export function protocolPinned(facts: Record<string, LastProtocol>, current: ProtocolCurrent): string | undefined {
  const fact = pickFact(facts, current)
  return typeof fact?.pinned === "string" && RUNGS.includes(fact.pinned) ? fact.pinned : undefined
}

/**
 * The sidebar protocol CELL (owner spec, 2026-09-26): the CONFIGURED mode
 * names the cell; `auto` wraps the protocol the last request actually used.
 * Never empty: absence of an oracle reads as FALSE.
 */
export function protocolLabel(configured: string | undefined, resolved: string | undefined, pinned?: string): string {
  const mode = configured && configured.length > 0 ? configured : "auto"
  if (mode !== "auto") return `${TRANSPORT_GLYPH} ${mode}`
  if (pinned && RUNGS.includes(pinned)) return `${TRANSPORT_GLYPH} ${pinned}`
  return `${TRANSPORT_GLYPH} auto(${resolved && resolved.length > 0 ? resolved : "unknown"})`
}

/**
 * The LIVING-CONNECTION badge (owner directive 2026-09-29): it answers about
 * the keep-alive H2 pool we hold — not auth, not the last request's outcome.
 * Never `unknown`: a zero or missing count renders disconnected, not blank.
 */
export function connectionBadge(h2Sessions: number | undefined): string {
  return (h2Sessions ?? 0) > 0 ? "●" : "○"
}
