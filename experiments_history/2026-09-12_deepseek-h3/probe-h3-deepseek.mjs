// DeepSeek h3 (HTTP/3) transport probe — rewrite of the novita h3 probe
// (experiments/2026-09-08_novita-h3-session-probes) for api.deepseek.com.
//
// Discriminator (same as novita/zen probes): Bun 1.3.14+ pinned-protocol fetch.
//   - A server WITHOUT h3 either errors the http3 pin (HTTP3HandshakeFailed) or
//     hangs/falls back; status + latency + alt-svc tell us which.
//   - alt-svc present with h3=":443" = server advertises QUIC (may still block it).
//   - control cloudflare-quic.com proves the CLIENT can do h3 at all.
//
// No secrets: key is read from env / bin/auth.json and only its LENGTH is printed.
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-h3-deepseek.mjs

import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"

function loadDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim()
  try {
    const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
    const entry = auth["deepseek"]
    if (entry?.key) return entry.key
  } catch {
    // fall through to the explicit failure below
  }
  return undefined
}

const KEY = loadDeepSeekKey()
console.log(`bun: ${Bun.version}`)
console.log(`deepseek key: ${KEY ? `present (len=${KEY.length})` : "MISSING"}`)

const TARGETS = [
  { name: "cloudflare-quic (control)", url: "https://cloudflare-quic.com/", auth: false },
  { name: "deepseek-root", url: "https://api.deepseek.com/", auth: true },
  { name: "deepseek-models", url: "https://api.deepseek.com/v1/models", auth: true },
]

for (const t of TARGETS) {
  if (t.auth && !KEY) {
    console.log(`\n${t.name}: SKIP (no deepseek key)`)
    continue
  }
  console.log(`\n--- ${t.name} ${t.url} ---`)
  for (const protocol of ["http2", "http3"]) {
    const t0 = performance.now()
    try {
      const res = await fetch(t.url, {
        method: "GET",
        headers: {
          "user-agent": "opencode-h3-probe",
          ...(t.auth ? { authorization: `Bearer ${KEY}` } : {}),
        },
        // Bun experimental client: "http2" | "http3"
        protocol,
      })
      const ms = Math.round(performance.now() - t0)
      const altSvc = res.headers.get("alt-svc") ?? "-"
      const server = res.headers.get("server") ?? "-"
      console.log(
        `${protocol.padEnd(6)}: status=${res.status} ${ms}ms alt-svc="${altSvc}" server="${server}"`,
      )
      await res.text().catch(() => "")
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      console.log(`${protocol.padEnd(6)}: ERROR(${ms}ms) ${e.name}: ${e.message}`.slice(0, 200))
    }
  }
}

// Verdict helper — read the output, do not self-grade.
console.log("\n=== Verdict ===")
console.log("h3 supported on api.deepseek.com ONLY if the deepseek http3 pin returned a")
console.log("status while the control ALSO passed. alt-svc h3=\"...\" alone = advertisement.")
