// Protocol row for the TUI sidebar — pure, so it is unit-testable in isolation.
// The blank row shipped TWICE as a defect (10.0.1106 rendered an empty string
// while the transport ran h2, 2026-09-24) and "absence of an oracle reads as
// FALSE" is now an AGENTS.md invariant: this function must never return "".
export type LastProtocol = {
  requestID: string
  providerID: string
  modelID: string
  protocol: string
  at: number
}

export function protocolRow(
  facts: Record<string, LastProtocol>,
  current: { requestID: string; sessionID: string; providerID: string; modelID: string; assistantCreatedAt: number },
): string {
  const fact = facts[current.requestID] ?? (current.providerID === "novita-ai" ? facts[current.sessionID] : undefined)
  if (fact?.providerID !== current.providerID || fact.modelID !== current.modelID) return "unknown"
  if (fact.at < current.assistantCreatedAt) return "unknown"
  return ["h3", "h2", "http/1.1"].includes(fact.protocol) ? fact.protocol : "unknown"
}
