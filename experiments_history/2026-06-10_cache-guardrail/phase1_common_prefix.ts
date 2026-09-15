/**
 * Extended: after 3 requests (A, B, A), does B now hit from common prefix detection?
 */

const API_KEY = process.env.DEEPSEEK_API_KEY!
const MODEL = "deepseek-chat"
const BASE = "https://api.deepseek.com/v1/chat/completions"
const WAIT = 6000

async function call(messages: Array<{ role: string; content: string }>) {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 60, temperature: 0, stream: false }),
  })
  const j = await r.json()
  const u = j.usage ?? {}
  const hit = u.prompt_cache_hit_tokens ?? 0
  const miss = u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0
  return { hit, miss, total: hit + miss, ratio: (hit / (hit + miss || 1) * 100).toFixed(1) }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const S = "You are a helpful assistant. Answer briefly."
const PREFIX = Array.from({ length: 12 }, (_, i) =>
  `- fact_${String(i + 1).padStart(2, "0")}: Component ${i + 1} handles ${["auth", "routing", "database", "caching", "logging", "metrics", "api", "ui", "state", "validation", "testing", "deployment"][i]}.`
).join("\n")

async function main() {
  console.log("Extended: After A→B→A cycle, does B now hit from common prefix detection?\n")

  // Same prefix, different questions
  const make = (q: string) => [
    { role: "system", content: S },
    { role: "user", content: `COMMON_PREFIX\n${PREFIX}\n\nQuestion: ${q}` },
  ]

  const r1 = await call(make("what handles auth?"))
  console.log(`1. A: hit=${r1.hit} miss=${r1.miss} ratio=${r1.ratio}%`)
  await sleep(WAIT)

  const r2 = await call(make("what handles routing?"))
  console.log(`2. B: hit=${r2.hit} miss=${r2.miss} ratio=${r2.ratio}%`)
  await sleep(WAIT)

  const r3 = await call(make("what handles database?"))
  console.log(`3. C: hit=${r3.hit} miss=${r3.miss} ratio=${r3.ratio}%`)
  await sleep(WAIT)

  const r4 = await call(make("what handles caching?"))
  console.log(`4. D: hit=${r4.hit} miss=${r4.miss} ratio=${r4.ratio}%`)
  await sleep(WAIT)

  const r5 = await call(make("what handles logging?"))
  console.log(`5. E: hit=${r5.hit} miss=${r5.miss} ratio=${r5.ratio}%`)

  console.log("\n── ANALYSIS ──")
  console.log(`Requests 1-2: cold start (no common prefix detected yet)`)

  if (r3.hit > 0) {
    const reqs_needed = 3
    console.log(`Request ${reqs_needed}: HIT! Common prefix detected after ${reqs_needed} requests.`)
  } else if (r4.hit > 0) {
    console.log(`Request 4: HIT! Common prefix detected after 4 requests.`)
  } else if (r5.hit > 0) {
    console.log(`Request 5: HIT! Common prefix detected after 5 requests.`)
  } else {
    console.log(`None hit. Common prefix detection may need more requests or longer prefix.`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
