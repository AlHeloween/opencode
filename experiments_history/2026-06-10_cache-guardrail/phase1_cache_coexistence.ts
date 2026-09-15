/**
 * Test: 2 cached variants → does a 3rd request sharing prefix with variant 1 hit?
 */

const API_KEY = process.env.DEEPSEEK_API_KEY!
const MODEL = "deepseek-chat"
const BASE = "https://api.deepseek.com/v1/chat/completions"
const WAIT = 6000

async function call(messages: Array<{ role: string; content: string }>) {
  const t0 = Date.now()
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 60, temperature: 0, stream: false }),
  })
  const j = await r.json()
  const ms = Date.now() - t0
  const u = j.usage ?? {}
  const hit = u.prompt_cache_hit_tokens ?? 0
  const miss = u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0
  return { hit, miss, total: hit + miss, ratio: (hit / (hit + miss || 1) * 100).toFixed(1), ms }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const S = "You are a helpful assistant. Answer briefly."
const PREFIX = Array.from({ length: 15 }, (_, i) =>
  `- fact_${String(i + 1).padStart(2, "0")}: Component ${i + 1} handles ${["auth", "routing", "database", "caching", "logging", "metrics", "api", "ui", "state", "validation", "testing", "deployment", "monitoring", "scheduling", "queue"][i]}.`
).join("\n")

async function main() {
  console.log("Test: 2 cached variants → 3rd request hits?")
  console.log(`Prefix: ${PREFIX.length} chars, model: ${MODEL}\n`)

  // Variant 1: prefix + question A
  const v1 = [
    { role: "system", content: S },
    { role: "user", content: `VARIANT_A\n${PREFIX}\n\nQuestion: what handles auth?` },
  ]

  // Variant 2: prefix + question B (different question)
  const v2 = [
    { role: "system", content: S },
    { role: "user", content: `VARIANT_B\n${PREFIX}\n\nQuestion: what handles routing?` },
  ]

  // Variant 3: same prefix as v1, same question as v1
  const v3 = [
    { role: "system", content: S },
    { role: "user", content: `VARIANT_A\n${PREFIX}\n\nQuestion: what handles auth?` },
  ]

  // Step 1: Cache variant A
  console.log("1. WARM-UP variant A:")
  const w1 = await call(v1)
  console.log(`   hit=${w1.hit} miss=${w1.miss} ratio=${w1.ratio}% time=${w1.ms}ms`)
  await sleep(WAIT)

  // Step 2: Cache variant B (different prefix from A)
  console.log("\n2. CACHE variant B (different question):")
  const w2 = await call(v2)
  console.log(`   hit=${w2.hit} miss=${w2.miss} ratio=${w2.ratio}% time=${w2.ms}ms`)
  console.log(`   → Variant B has ${w2.hit > 0 ? "SOME" : "NO"} cache hits from variant A's prefix`)
  await sleep(WAIT)

  // Step 3: Send variant A again — should hit from step 1's cache
  console.log("\n3. TEST variant A AGAIN (same as step 1):")
  const t = await call(v3)
  console.log(`   hit=${t.hit} miss=${t.miss} ratio=${t.ratio}% time=${t.ms}ms`)

  console.log("\n── ANALYSIS ──")
  if (t.hit > 0) {
      console.log(`  Third request HIT cache (${t.hit} tokens).`)
      console.log(`  DeepSeek retained variant A's cache unit even after variant B was cached.`)
      console.log(`  → Multiple prefix units coexist. Old units survive new cache insertions.`)
  } else {
      console.log(`  Third request MISSED cache.`)
      if (w1.hit === 0) {
          console.log(`  → First request was cold. Cache never established.`)
      } else {
          console.log(`  → Variant B may have evicted variant A's cache unit.`)
      }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
