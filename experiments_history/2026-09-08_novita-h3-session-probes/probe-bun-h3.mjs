// Bun 1.4.x HTTP/3 capability probe — both sides:
//   SERVER: does Bun.serve accept h3:true / http3:true (user-cited claim)?
//   CLIENT: does fetch()/Bun.quic expose any h3 client path (our Novita need)?
// Usage: bun scripts/probe-bun-h3.mjs

console.log("bun:", Bun.version)

// ── SERVER side ──────────────────────────────────────────────────────────
for (const flag of ["h3", "http3"]) {
  try {
    const opts = { port: 0, fetch: () => new Response("ok") }
    opts[flag] = true
    const server = Bun.serve(opts)
    console.log(`Bun.serve ${flag}:true -> ACCEPTED (listening tcp:${server.port}${server.portUdp ? ` udp:${server.portUdp}` : ""})`)
    server.stop(true)
  } catch (e) {
    console.log(`Bun.serve ${flag}:true -> REJECTED (${e.message})`)
  }
}
// Extra surface the option type would reveal even without a live bind:
console.log("Bun.serve option keys documented on Bun.serve type:", "(see bun-types grep)")

// ── CLIENT side ──────────────────────────────────────────────────────────
console.log("Bun.quic:", typeof Bun.quic)

try {
  const res = await fetch("https://api.novita.ai/v3/openai/models", {
    headers: { "user-agent": "opencode-probe/1.0" },
  })
  console.log("novita fetch status:", res.status)
  for (const [k, v] of res.headers) {
    if (/alt-svc|h3|quic/i.test(k)) console.log(`  ${k}: ${v}`)
  }
} catch (e) {
  console.log("novita fetch failed:", e.message)
}
