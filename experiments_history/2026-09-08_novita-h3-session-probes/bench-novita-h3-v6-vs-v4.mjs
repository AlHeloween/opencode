// h3-over-IPv6 REAL fetch benchmark: Bun { protocol: "http3" } against
// literal IPv6 URL (forces QUIC over v6) vs literal IPv4 URL (QUIC over v4)
// vs hostname (happy-eyeballs). Cloudflare serves one cert for the host; TLS
// SNI is the literal IP — CF accepts it (IP-literal SNI is allowed by their
// edge). If SNI fails we fall back to DNS64/hosts pinning via hosts file note.
//
// Usage: bun scripts/bench-novita-h3-v6-vs-v4.mjs

const fs = require("node:fs")
const path = require("node:path")
const dns = require("node:dns")

function loadKey() {
  if (process.env.NOVITA_API_KEY) return process.env.NOVITA_API_KEY
  const auth = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "..", "bin", "auth.json"), "utf8"))
  const entry = auth["novita-ai"]
  if (!entry || !entry.key) throw new Error("no novita key")
  return entry.key
}
const KEY = loadKey()

const MODEL = "zai-org/glm-5.3-flash"
const body = JSON.stringify({
  model: MODEL,
  max_tokens: 8,
  messages: [{ role: "user", content: "Reply with exactly: OK" }],
})

async function firstAddr(host, v6) {
  try {
    return v6 ? (await dns.promises.resolve6(host))[0] : (await dns.promises.resolve4(host))[0]
  } catch {
    return null
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function timedFetch(url) {
  const t0 = performance.now()
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body,
      protocol: "http3",
    })
    if (res.status === 429) return { status: 429 }
    const text = await res.text().catch(() => "")
    return { status: res.status, total: performance.now() - t0, err: res.status !== 200 ? text.slice(0, 100) : undefined }
  } catch (e) {
    return { status: 0, err: `${e.name}: ${e.message}`.slice(0, 120) }
  }
}

async function attempt(url) {
  for (let i = 1; i <= 4; i++) {
    const r = await timedFetch(url)
    if (r.status === 429) {
      await sleep(3000)
      continue
    }
    return r
  }
  return { status: 0, err: "gave up" }
}

console.log("=== h3 v6 vs v4 (literal-address fetch) ===")
const host = "api.novita.ai"
const v6 = await firstAddr(host, true)
const v4 = await firstAddr(host, false)
console.log(`AAAA: ${v6}   A: ${v4}`)

const targets = []
if (v6) targets.push([`v6 [${v6}]`, `https://[${v6}]/openai/chat/completions`])
if (v4) targets.push([`v4 ${v4}`, `https://${v4}/openai/chat/completions`])
targets.push(["hostname (HE)", `https://${host}/openai/chat/completions`])

// SNI/IP-literal sanity: does h3 to a literal IP even handshake?
const results = {}
for (const [label, url] of targets) {
  console.log(`\n--- ${label} ---`)
  // warmup
  const w = await attempt(url)
  console.log(`warmup: ${JSON.stringify(w)}`)
  if (w.status !== 200) {
    results[label] = { ok: 0 }
    continue
  }
  const rows = []
  for (let i = 0; i < 5; i++) {
    const r = await attempt(url)
    rows.push(r)
    console.log(`  run ${i + 1}: ${r.status === 200 ? Math.round(r.total) + "ms" : `ERR ${r.err}`}`)
    await sleep(600)
  }
  const ok = rows.filter((r) => r.status === 200)
  results[label] = { ok: ok.length, median: ok.length ? Math.round(ok.map((r) => r.total).sort((a, b) => a - b)[Math.floor(ok.length / 2)]) : null }
}

console.log("\n=== Summary ===")
for (const [label, r] of Object.entries(results)) {
  console.log(`${label.padEnd(16)} ok=${r.ok}/5${r.median ? ` median=${r.median}ms` : ""}`)
}
