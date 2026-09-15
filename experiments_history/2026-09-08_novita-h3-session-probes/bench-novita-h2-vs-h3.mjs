// NovitaAI h2 vs h3 transport benchmark — real chat completions, interleaved.
//
// Claims under test:
//   "h3 is 50% faster than h2"  (user; source: Bun blog server-vs-h1.1 loopback)
// Decisive metrics for OUR workload (LLM streaming):
//   TTFB (time to first SSE byte)  — includes connection setup when cold
//   total stream time
//   error/fallback rate
//
// Design:
//   - per-request protocol pinning: { protocol: "http2" } vs { protocol: "http3" }
//     (Bun 1.3.14+ experimental client, blog-verified API)
//   - INTERLEAVED h2/h3 pairs (decorrelates upstream 429 roulette + load)
//   - identical tiny prompt (cache state equal across arms after req1)
//   - 429 -> retry up to 4x with 3s backoff (capacity roulette, not transport)
//   - warmup pair first so BOTH arms get connection-setup cost in warmup, then
//     report steady-state TTFB (plus one cold-start pair for the h3 handshake view)
//
// Usage: bun scripts/bench-novita-h2-vs-h3.mjs

const MODEL = "zai-org/glm-5.3-flash"
const URL = "https://api.novita.ai/openai/chat/completions"

function loadKey() {
  if (process.env.NOVITA_API_KEY) return process.env.NOVITA_API_KEY
  const auth = JSON.parse(require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "..", "bin", "auth.json"), "utf8"))
  const entry = auth["novita-ai"]
  if (!entry || !entry.key) throw new Error("no novita key")
  return entry.key
}
const KEY = loadKey()

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
        "x-request-id": `req_bench_${protocol}_${Date.now()}`,
      },
      body,
      protocol, // "http2" | "http3" — Bun experimental client (1.3.14+)
      // @ts-ignore
      verbose: false,
    })
    const tStatus = performance.now()
    if (res.status === 429) return { protocol, status: 429 }
    if (res.status !== 200) {
      const text = await res.text().catch(() => "")
      return { protocol, status: res.status, error: text.slice(0, 120) }
    }
    // stream read: TTFB at first byte, total at stream end
    let ttfb = null
    let bytes = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (ttfb === null) ttfb = performance.now() - tStatus
      bytes += value?.length ?? 0
    }
    const total = performance.now() - t0
    return { protocol, status: res.status, ttfb, total, bytes }
  } catch (e) {
    return { protocol, status: 0, error: `${e.name}: ${e.message}`.slice(0, 140) }
  }
}

async function attempt(protocol) {
  for (let i = 1; i <= 4; i++) {
    const r = await timedRequest(protocol)
    if (r.status === 429) {
      process.stdout.write(`   ${protocol} 429 (retry ${i}/4)`)
      await sleep(3000)
      continue
    }
    return r
  }
  return { protocol, status: 0, error: "gave up after 429s" }
}

function stats(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === "number").sort((a, b) => a - b)
  if (!vals.length) return null
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const median = vals[Math.floor(vals.length / 2)]
  return { median: Math.round(median), mean: Math.round(mean), n: vals.length, min: Math.round(vals[0]), max: Math.round(vals[vals.length - 1]) }
}

console.log("=== Novita h2 vs h3 interleaved benchmark ===")
console.log("warmup pair (connection setup cost lands here)...")
await attempt("http2")
await attempt("http3")

const PAIRS = 6
const rows = []
for (let i = 1; i <= PAIRS; i++) {
  // alternate order per pair to cancel order bias
  const order = i % 2 === 1 ? ["http2", "http3"] : ["http3", "http2"]
  const pair = []
  for (const p of order) {
    const r = await attempt(p)
    pair.push(r)
    await sleep(700)
  }
  for (const r of pair) {
    rows.push(r)
    const ttfb = typeof r.ttfb === "number" ? `${Math.round(r.ttfb)}ms` : "-"
    const total = typeof r.total === "number" ? `${Math.round(r.total)}ms` : "-"
    console.log(`pair ${i} ${String(r.protocol).padEnd(7)} status=${r.status} ttfb=${ttfb} total=${total}${r.error ? ` ERR: ${r.error}` : ""}`)
  }
}

console.log("\n=== Results ===")
for (const p of ["http2", "http3"]) {
  const arm = rows.filter((r) => r.protocol === p && r.status === 200)
  const ok = arm.length
  console.log(`${p}: ok=${ok}/${PAIRS}`)
  if (ok) {
    console.log(`   ttfb  median=${stats(arm, "ttfb")?.median}ms (min ${stats(arm, "ttfb")?.min}, max ${stats(arm, "ttfb")?.max})`)
    console.log(`   total median=${stats(arm, "total")?.median}ms (min ${stats(arm, "total")?.min}, max ${stats(arm, "total")?.max})`)
  }
}
const h2t = stats(rows.filter((r) => r.protocol === "http2" && r.status === 200), "ttfb")
const h3t = stats(rows.filter((r) => r.protocol === "http3" && r.status === 200), "ttfb")
if (h2t && h3t) {
  const delta = Math.round(((h2t.median - h3t.median) / h2t.median) * 100)
  console.log(`\nTTFB delta: h3 vs h2 = ${delta > 0 ? "+" : ""}${delta}%  (negative = h3 faster)`)
}
