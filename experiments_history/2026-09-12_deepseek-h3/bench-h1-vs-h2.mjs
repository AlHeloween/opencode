// DeepSeek h1 vs h2 transport benchmark — real streaming chat completions,
// interleaved. Rewrite of the novita bench for api.deepseek.com.
//
// Why: the h3 probe (probe-h3-deepseek.mjs) showed
//   - h3  -> HTTP3HandshakeFailed, no alt-svc  (server does not serve QUIC)
//   - h2  -> status 200 on /v1/models          (server DOES negotiate h2)
// while resolveGatewayProtocol() currently pins deepseek to http/1.1.
// This bench decides whether the family default should move to h2.
//
// Design mirrors the novita/zen benches:
//   - per-request protocol pinning: { protocol: "http1.1" } vs { protocol: "http2" }
//   - INTERLEAVED pairs (cancels upstream load drift)
//   - identical tiny prompt (cache state equal across arms after warmup)
//   - warmup pair first so connection setup lands there
//   - reports TTFB (first SSE byte) + total, which is what an LLM workload feels
//
// Usage: bun experiments/2026-09-12_deepseek-h3/bench-h1-vs-h2.mjs

import { readFileSync } from "node:fs"
import { join } from "node:path"

function loadKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim()
  try {
    const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
    if (auth["deepseek"]?.key) return auth["deepseek"].key
  } catch {
    // explicit failure below
  }
  return undefined
}

const KEY = loadKey()
if (!KEY) {
  console.error("no deepseek key: set DEEPSEEK_API_KEY")
  process.exit(1)
}

const MODEL = process.argv[2] ?? "deepseek-flash"
const URL = "https://api.deepseek.com/chat/completions"
const body = JSON.stringify({
  model: MODEL,
  max_tokens: 16,
  messages: [{ role: "user", content: "Reply with exactly: OK" }],
  stream: true,
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function timedRequest(protocol) {
  const t0 = performance.now()
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "user-agent": "opencode-transport-bench",
      },
      body,
      protocol, // "http1.1" | "http2" — Bun pinned-protocol client
    })
    const tStatus = performance.now()
    if (res.status !== 200) {
      const text = await res.text().catch(() => "")
      return { protocol, status: res.status, error: text.slice(0, 120) }
    }
    let ttfb = null
    let bytes = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (ttfb === null) ttfb = performance.now() - tStatus
      bytes += value?.length ?? 0
    }
    return { protocol, status: res.status, ttfb, total: performance.now() - t0, bytes }
  } catch (e) {
    return { protocol, status: 0, error: `${e.name}: ${e.message}`.slice(0, 140) }
  }
}

function stats(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === "number").sort((a, b) => a - b)
  if (!vals.length) return null
  return {
    median: Math.round(vals[Math.floor(vals.length / 2)]),
    min: Math.round(vals[0]),
    max: Math.round(vals[vals.length - 1]),
    n: vals.length,
  }
}

console.log(`=== DeepSeek h1 vs h2 interleaved benchmark (model ${MODEL}) ===`)
console.log("warmup pair (connection setup cost lands here)...")
await timedRequest("http1.1")
await timedRequest("http2")

const PAIRS = 6
const rows = []
for (let i = 1; i <= PAIRS; i++) {
  const order = i % 2 === 1 ? ["http1.1", "http2"] : ["http2", "http1.1"]
  for (const p of order) {
    const r = await timedRequest(p)
    rows.push(r)
    const ttfb = typeof r.ttfb === "number" ? `${Math.round(r.ttfb)}ms` : "-"
    const total = typeof r.total === "number" ? `${Math.round(r.total)}ms` : "-"
    console.log(`pair ${i} ${p.padEnd(8)} status=${r.status} ttfb=${ttfb} total=${total}${r.error ? ` ERR: ${r.error}` : ""}`)
    await sleep(700)
  }
}

console.log("\n=== Results ===")
for (const p of ["http1.1", "http2"]) {
  const arm = rows.filter((r) => r.protocol === p && r.status === 200)
  console.log(`${p}: ok=${arm.length}/${PAIRS}`)
  if (arm.length) {
    const t = stats(arm, "ttfb")
    const tot = stats(arm, "total")
    console.log(`   ttfb  median=${t.median}ms (min ${t.min}, max ${t.max})`)
    console.log(`   total median=${tot.median}ms (min ${tot.min}, max ${tot.max})`)
  }
}
const h1 = stats(rows.filter((r) => r.protocol === "http1.1" && r.status === 200), "ttfb")
const h2 = stats(rows.filter((r) => r.protocol === "http2" && r.status === 200), "ttfb")
if (h1 && h2) {
  const delta = Math.round(((h1.median - h2.median) / h1.median) * 100)
  console.log(`\nTTFB delta: h2 vs h1 = ${delta > 0 ? "+" : ""}${delta}%  (negative = h2 faster)`)
}
