// Anthropic h3 (HTTP/3) transport probe — rewrite of the DeepSeek probe
// (experiments/2026-09-12_deepseek-h3/probe-h3-deepseek.mjs) for api.anthropic.com.
//
// Discriminator: Bun 1.3.14+ pinned-protocol fetch.
//   - a server WITHOUT h3 either errors the http3 pin (HTTP3HandshakeFailed)
//     or hangs; status + latency + alt-svc say which.
//   - alt-svc carrying h3=":443" = the server advertises QUIC.
//   - cloudflare-quic.com is the control: it proves the CLIENT can do h3.
//
// No auth needed: a 401 from the API still proves the transport handshake
// succeeded, which is the whole question here. No secrets are read or printed.
//
// Usage: bun run experiments/2026-09-12_anthropic-catalog-h3/probe-h3-anthropic.mjs

console.log(`bun: ${Bun.version}`)

const TARGETS = [
  { name: "cloudflare-quic (control)", url: "https://cloudflare-quic.com/" },
  { name: "anthropic-root", url: "https://api.anthropic.com/" },
  { name: "anthropic-models", url: "https://api.anthropic.com/v1/models" },
  { name: "anthropic-messages (POST-less GET)", url: "https://api.anthropic.com/v1/messages" },
]

const REPEATS = Number(process.env.PROBE_REPEATS ?? 3)

for (const target of TARGETS) {
  console.log(`\n--- ${target.name}  ${target.url} ---`)
  for (const protocol of ["http2", "http3"]) {
    const samples = []
    let last = null
    for (let i = 0; i < REPEATS; i++) {
      const started = performance.now()
      try {
        const res = await fetch(target.url, {
          method: "GET",
          headers: { "user-agent": "opencode-h3-probe", "anthropic-version": "2023-06-01" },
          protocol,
        })
        samples.push(Math.round(performance.now() - started))
        last = {
          status: res.status,
          altSvc: res.headers.get("alt-svc") ?? "-",
          server: res.headers.get("server") ?? "-",
        }
      } catch (error) {
        samples.push(Math.round(performance.now() - started))
        last = { error: String(error?.message ?? error).slice(0, 120) }
        break
      }
    }
    const median = samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)]
    console.log(
      `${protocol.padEnd(6)} ${
        last?.error
          ? `ERROR ${last.error}`
          : `status=${last.status} server=${last.server} alt-svc=${last.altSvc}`
      }  ms=${samples.join("/")} median=${median}`,
    )
  }
}

console.log(
  "\nReading: h3 is only worth pursuing when the control succeeds AND the target" +
    "\nadvertises alt-svc h3 AND the pinned http3 request returns a status.",
)
