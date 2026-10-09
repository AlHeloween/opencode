// Sidebar transport row helpers — pure, so they are unit-testable in isolation.
// TWO axes, deliberately not fused: the RUNG a request ran on (`protocolRow`/`protocolLabel`)
// and whether a KEEP-ALIVE H2 SESSION is open right now (`connectionBadge`).
// The blank row shipped TWICE as a defect (10.0.1106 rendered an empty string
// while the transport ran h2, 2026-09-24) and "absence of an oracle reads as
// FALSE" is now an AGENTS.md invariant: no helper here may return "".
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
 * The glyph that DEPICTS the protocol axis (T4(b), owner addendum 2026-09-29T09:34Z:
 * «протокол ... тоже [изобразить значком]»). It leads every cell — the rung text stays
 * verbatim behind it, and even the `unknown` cell keeps the glyph: a blank reads as FALSE
 * (AGENTS.md).
 */
const TRANSPORT_GLYPH = "⇅"

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
 * Since T4(b) the cell ALSO leads with the transport glyph: the protocol axis is depicted by
 * the glyph, and the rung text is what stays behind it.
 *
 * A PINNED rung is the setting, not a measurement (owner, 2026-09-29): the runtime writes the
 * probe outcome once and reads it on every later request, so `auto(h2)` advertised a probe that
 * no longer happens — «это означает что мы будем пробать или после каждого сообщения или при
 * старте сессии». Only a route with no pin yet keeps the `auto(...)` form, and there the
 * wrapping is honest.
 */
export function protocolLabel(configured: string | undefined, resolved: string | undefined, pinned?: string): string {
  const mode = configured && configured.length > 0 ? configured : "auto"
  if (mode !== "auto") return `${TRANSPORT_GLYPH} ${mode}`
  if (pinned && RUNGS.includes(pinned)) return `${TRANSPORT_GLYPH} ${pinned}`
  return `${TRANSPORT_GLYPH} auto(${resolved && resolved.length > 0 ? resolved : "unknown"})`
}

/**
 * The LIVING-CONNECTION badge — owner directive 2026-09-29 (screenshot 2): «в tui sidebar не
 * только протокол но и значек - connected disconnected - обычная иконка». The owner named the
 * source himself: a KEEP-ALIVE H2 SESSION we hold — not auth, not the last request's outcome.
 *
 * `h2Sessions` is the live status the gateway publishes every 5 s (`gateway/mod.ts`), summed
 * over the origin pools by `h2-transport.ts:getSessionCount`. The badge answers its OWN question
 * and deliberately does not borrow the protocol row's: an h3 or h1 request says nothing about
 * whether our h2 pool is warm. It is never `unknown` for the same reason — a zero or missing
 * count is a true statement about our pool, and it renders the disconnected glyph rather than a
 * blank, because absence of an oracle reads as FALSE (AGENTS.md).
 */
export function connectionBadge(h2Sessions: number | undefined): string {
  return (h2Sessions ?? 0) > 0 ? "●" : "○"
}
