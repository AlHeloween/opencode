// Protocol choices for the TUI model-parameters dialog — pure, so the menu
// contract (h3-first order, h1 marked fallback-only, configured rung marked)
// is unit-testable without mounting the dialog.
export type ProtocolChoice = { value: string; title: string; description: string; footer?: string }

export const PROTOCOLS: Array<{ value: string; title: string; description: string }> = [
  { value: "auto", title: "auto", description: "Probe h3 first, downgrade to h2, h1 only as last resort" },
  { value: "h3", title: "h3", description: "Pin HTTP/3 (QUIC); falls back to h2, then h1" },
  { value: "h2", title: "h2", description: "Pin HTTP/2; falls back to h1" },
  { value: "http/1.1", title: "http/1.1", description: "Legacy rung — fallback only, not recommended" },
]

export function protocolChoices(configured: string): ProtocolChoice[] {
  return PROTOCOLS.map((item) => ({
    ...item,
    footer: item.value === configured ? "configured" : undefined,
  }))
}
