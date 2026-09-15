// h3 server-side probe for openrouter + opencode zen (same discriminator as
// the novita probe 2026-09-08): Bun 1.3.14+ pinned-protocol fetch.
// A server without h3 either errors the http3 pin or hangs/falls back —
// status+latency+alt-svc tell us which.
//
// Usage: bun experiments/2026-09-11_openrouter-zen-h3/probe-h3.mjs

const TARGETS = [
  { name: "openrouter", url: "https://openrouter.ai/api/v1/models" },
  { name: "zen", url: "https://opencode.ai/zen/v1/models" },
  { name: "zen-go", url: "https://opencode.ai/zen/go/v1/models" },
]

for (const t of TARGETS) {
  for (const protocol of ["http2", "http3"]) {
    const t0 = performance.now()
    try {
      const res = await fetch(t.url, {
        method: "GET",
        headers: { "user-agent": "opencode-h3-probe" },
        protocol, // Bun experimental client: "http2" | "http3"
        // @ts-ignore
        verbose: false,
      })
      const ms = Math.round(performance.now() - t0)
      const altSvc = res.headers.get("alt-svc") ?? "-"
      const server = res.headers.get("server") ?? "-"
      console.log(`${t.name} ${protocol}: status=${res.status} ${ms}ms alt-svc="${altSvc}" server="${server}"`)
      await res.text().catch(() => "")
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      console.log(`${t.name} ${protocol}: ERROR(${ms}ms) ${e.name}: ${e.message}`.slice(0, 200))
    }
  }
}
