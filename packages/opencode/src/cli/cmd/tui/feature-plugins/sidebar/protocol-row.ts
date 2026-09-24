// Protocol row for the TUI sidebar — pure, so it is unit-testable in isolation.
// The blank row shipped TWICE as a defect (10.0.1106 rendered an empty string
// while the transport ran h2, 2026-09-24) and "absence of an oracle reads as
// FALSE" is now an AGENTS.md invariant: this function must never return "".
export type LastProtocol = { provider?: string; model?: string; protocol?: string; at?: number }

export function protocolRow(live: LastProtocol | undefined, configured: string | undefined): string {
  return live?.protocol || configured || "auto"
}
