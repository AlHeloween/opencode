// Protocol row for the TUI sidebar — pure, so it is unit-testable in isolation.
// The blank row shipped TWICE as a defect (10.0.1106 rendered an empty string
// while the transport ran h2, 2026-09-24) and "absence of an oracle reads as
// FALSE" is now an AGENTS.md invariant: this function must never return "".
export type LastProtocol = {
  requestID: string
  providerID: string
  modelID: string
  protocol: string
  /**
   * The rung this route is PINNED to, read back from the persistent route store AFTER the
   * request (`null` when nothing was pinned). Only the adapter's own event carries it.
   */
  pinned?: string | null
  at: number
}

/** The rungs the sidebar may name. Anything else is a policy, not a measured transport. */
const RUNGS = ["h3", "h2", "http/1.1"]

/**
 * The ONE fact that answers for the current assistant turn. Both readers below share it, so the
 * rung and its pinned flag can never come from two different requests.
 */
function pickFact(
  facts: Record<string, LastProtocol>,
  current: { requestID: string; sessionID: string; providerID: string; modelID: string; assistantCreatedAt: number },
): LastProtocol | undefined {
  const fact = facts[current.requestID] ?? (current.providerID === "novita-ai" ? facts[current.sessionID] : undefined)
  if (fact?.providerID !== current.providerID || fact.modelID !== current.modelID) return undefined
  if (fact.at < current.assistantCreatedAt) return undefined
  return fact
}

export function protocolRow(
  facts: Record<string, LastProtocol>,
  current: { requestID: string; sessionID: string; providerID: string; modelID: string; assistantCreatedAt: number },
): string {
  const fact = pickFact(facts, current)
  if (!fact) return "unknown"
  return RUNGS.includes(fact.protocol) ? fact.protocol : "unknown"
}

/**
 * The rung the route is PINNED to, for the same turn. Present only when the request ran on an
 * `auto` route whose outcome the runtime wrote into the persistent route store — i.e. the rung
 * the NEXT request reads without trialling again.
 */
export function protocolPinned(
  facts: Record<string, LastProtocol>,
  current: { requestID: string; sessionID: string; providerID: string; modelID: string; assistantCreatedAt: number },
): string | undefined {
  const fact = pickFact(facts, current)
  return typeof fact?.pinned === "string" && RUNGS.includes(fact.pinned) ? fact.pinned : undefined
}

/**
 * The sidebar protocol CELL (owner spec, 2026-09-26): the CONFIGURED mode names the cell; `auto`
 * wraps the protocol the last request actually used — «если auto → auto(выбранный протокол),
 * если не auto → протокол». Never empty: absence of an oracle reads as FALSE (AGENTS.md).
 *
 * A PINNED rung is the setting, not a measurement (owner, 2026-09-29): the runtime writes the
 * probe outcome once and reads it on every later request, so `auto(h2)` advertised a probe that
 * no longer happens — «это означает что мы будем пробать или после каждого сообщения или при
 * старте сессии». Only a route with no pin yet keeps the `auto(...)` form, and there the
 * wrapping is honest.
 */
export function protocolLabel(configured: string | undefined, resolved: string | undefined, pinned?: string): string {
  const mode = configured && configured.length > 0 ? configured : "auto"
  if (mode !== "auto") return mode
  if (pinned && RUNGS.includes(pinned)) return pinned
  return `auto(${resolved && resolved.length > 0 ? resolved : "unknown"})`
}
