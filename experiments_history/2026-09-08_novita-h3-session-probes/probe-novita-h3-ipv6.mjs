// h3-over-IPv6 probe: force AAAA resolution for api.novita.ai, verify QUIC/h3
// works over v6 (user directive: "h3 через ipv6").
//
// Method: resolve AAAA -> pin via undici-style custom lookup is not exposed to
// Bun fetch, so we test at TLS/QUIC level with a direct QUIC ALPN probe over
// the v6 address, then confirm Bun fetch happy-eyeballs path with DNS forced
// to v6 via NODE_OPTIONS is not available — instead we verify:
//   1. Bun fetch works with the hostname (baseline)
//   2. raw QUIC Initial packet can be sent to the v6 address (h3 alpn) using
//      Bun UDP socket — proves v6 UDP reachability of the QUIC endpoint
//   3. cloudflare-quic.com control over v6
// Usage: bun scripts/probe-novita-h3-ipv6.mjs

const dns = require("node:dns")

async function aaaa(host) {
  try {
    return await dns.promises.resolve6(host)
  } catch {
    return []
  }
}

// QUIC v1 Initial packets start with a fixed header byte; we only need to
// prove the UDP path accepts our packet and (ideally) answers — a Version
// Negotiation or Initial response. Send a minimal UDP datagram; any reply =
// v6 QUIC endpoint reachable.
function quicProbe(addr, port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let closed = false
    const finish = (result) => {
      if (closed) return
      closed = true
      clearTimeout(t)
      try {
        sock.close()
      } catch {}
      resolve(result)
    }
    let sock
    try {
      sock = Bun.udpSocket({
        socket: {
          data(_sock, data, from) {
            // Version negotiation packets start with flags byte then version 0x00000000
            const isVneg = data.length > 5 && data[0] >> 7 === 1 && data[1] === 0 && data[2] === 0
            finish({ reachable: true, bytes: data.length, from: `${from.address}:${from.port}`, versionNegotiation: isVneg })
          },
          error(_sock, err) {
            finish({ reachable: false, note: `socket error: ${err.message ?? err}` })
          },
        },
      })
    } catch (e) {
      resolve({ reachable: false, note: `udp socket unavailable: ${e.message}` })
      return
    }
    const t = setTimeout(() => finish({ reachable: false, note: "no answer within timeout" }), timeoutMs)
    // Long-coalesced packet that is still a plausible QUIC Initial (63-bit form):
    // first byte 0b11000000 = long header, version 0 (version negotiation trigger)
    const versionNegotiationPoke = Buffer.from([0xc0, 0x00, 0x00, 0x00, 0x08, ...Buffer.from("probe123".padEnd(8, "\0"))])
    try {
      sock.send(versionNegotiationPoke, port, addr)
    } catch (e) {
      finish({ reachable: false, note: `send error: ${e.message}` })
    }
  })
}

console.log("=== h3 over IPv6 probe ===")
for (const host of ["cloudflare-quic.com", "api.novita.ai"]) {
  const v6 = await aaaa(host)
  console.log(`\n--- ${host} ---`)
  console.log(`AAAA: ${v6.length ? v6.join(", ") : "NONE"}`)
  if (!v6.length) continue
  const r = await quicProbe(v6[0])
  console.log(`QUIC/UDPv6 ${v6[0]}:443 -> ${r.reachable ? `REPLY ${r.bytes}B from ${r.from}${r.versionNegotiation ? " (version negotiation)" : ""}` : `NO REPLY (${r.note})`}`)
}

// Bun fetch baseline still over default happy-eyeballs (v4/v6 auto)
const res = await fetch("https://api.novita.ai/v3/openai/models")
console.log(`\nBun fetch baseline: status ${res.status}, alt-svc: ${res.headers.get("alt-svc")}`)
