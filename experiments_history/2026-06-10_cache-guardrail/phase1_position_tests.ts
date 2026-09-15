/**
 * Position Cache Tests B, C, D, E
 * 
 * Reports after each test. User decides to continue.
 */

const API_KEY = process.env.DEEPSEEK_API_KEY!
const MODEL = "deepseek-chat"
const BASE = "https://api.deepseek.com/v1/chat/completions"
const WAIT = 6000

async function call(messages: Array<{ role: string; content: string }>, maxTokens = 80) {
  const t0 = Date.now()
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0, stream: false }),
  })
  const j = await r.json()
  const ms = Date.now() - t0
  const u = j.usage ?? {}
  const hit = u.prompt_cache_hit_tokens ?? 0
  const miss = u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0
  return { hit, miss, total: hit + miss, ratio: (hit / (hit + miss || 1) * 100).toFixed(1), ms, ok: r.ok }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFacts(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `- fact_${String(i + 1).padStart(2, "0")}: This component handles ${["auth", "routing", "database", "caching", "logging", "metrics", "api", "ui", "state", "validation", "testing", "deployment", "monitoring", "scheduling", "queue", "search", "notification", "encoding", "parsing", "rendering"][i % 20]} for the project.`)
}

function msg(system: string, user: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

const SYSTEM = "You are a helpful assistant. Answer briefly."

// ── Test B: 20 facts, reorder one ─────────────────────────────────────────

async function testB() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST B: 20 facts, swap fact_05 ↔ fact_10")
  console.log("=".repeat(60))

  const facts = makeFacts(20)
  const question = "\n\nQuestion: how many facts mention auth?"

  // facts in order: 01-20
  const ordered = facts.join("\n")
  // facts reordered: swap 05 (idx 4) with 10 (idx 9)
  const reorderedFacts = [...facts]
  reorderedFacts[4] = facts[9]
  reorderedFacts[9] = facts[4]
  const reordered = reorderedFacts.join("\n")

  console.log("\n1. WARM-UP (original order):")
  const w = await call(msg(SYSTEM, ordered + question))
  console.log(`   hit=${w.hit} miss=${w.miss} ratio=${w.ratio}%`)

  console.log(`\n2. Wait ${WAIT / 1000}s...`)
  await sleep(WAIT)

  console.log("\n3. SAME order, different question:")
  const t1 = await call(msg(SYSTEM, ordered + "\n\nQuestion: list fact_01 content."))
  console.log(`   hit=${t1.hit} miss=${t1.miss} ratio=${t1.ratio}%`)

  console.log("\n4. REORDERED (fact_05 ↔ fact_10), same question:")
  const t2 = await call(msg(SYSTEM, reordered + question))
  console.log(`   hit=${t2.hit} miss=${t2.miss} ratio=${t2.ratio}%`)

  if (t1.hit > 0 && t2.hit > 0) {
    console.log(`\n  → Reorder did NOT kill cache entirely. Facts before swap point still hit.`)
  } else if (t1.hit > 0 && t2.hit === 0) {
    console.log(`\n  → Reorder KILLED all cache. Swap at position 5 broke chain.`)
  } else {
    console.log(`\n  → Inconclusive.`)
  }
  return { same: t1, reordered: t2 }
}

// ── Test C: Timestamp per message ──────────────────────────────────────────

async function testC() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST C: Timestamp at fixed position in EVERY message")
  console.log("=".repeat(60))

  const makeMsgs = (ts1: string, ts2: string) => [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: `[${ts1}] First question: what is TypeScript?` },
    { role: "assistant" as const, content: "TypeScript is a typed superset of JavaScript." },
    { role: "user" as const, content: `[${ts2}] Second question: what are types?` },
  ]

  const warmUp = makeMsgs("2026-06-10T14:30:00", "2026-06-10T14:30:05")
  const test = makeMsgs("2026-06-10T14:30:01", "2026-06-10T14:30:06")

  console.log("\n1. WARM-UP (ts=00,05):")
  const w = await call(warmUp)
  console.log(`   hit=${w.hit} miss=${w.miss} ratio=${w.ratio}%`)

  console.log(`\n2. Wait ${WAIT / 1000}s...`)
  await sleep(WAIT)

  console.log("\n3. TEST (ts=01,06 — first timestamp differs by 1 second):")
  const t = await call(test)
  console.log(`   hit=${t.hit} miss=${t.miss} ratio=${t.ratio}%`)

  if (t.hit > 0) {
    console.log(`\n  → System prompt hit. Timestamp divergence isolated to user[0] timestamp.`)
  } else if (t.hit === 0 && w.hit === 0) {
    console.log(`\n  → Both cold. Cache may need more time or prefix too short.`)
  } else {
    console.log(`\n  → Timestamp change killed cache at first divergence.`)
  }
}

// ── Test D: Space-shift middle message ─────────────────────────────────────

async function testD() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST D: Space-shift middle message — position matters?")
  console.log("=".repeat(60))

  const assistant1 = "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript."
  const assistant2 = "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.  " // +2 spaces

  const warmUp = [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: "What is TypeScript?" },
    { role: "assistant" as const, content: assistant1 },
    { role: "user" as const, content: "What version?" },
  ]

  const shifted = [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: "What is TypeScript?" },
    { role: "assistant" as const, content: assistant2 },   // 2 extra spaces at end
    { role: "user" as const, content: "What version?" },    // identical user message but shifted position
  ]

  console.log(`\n  assistant1 length: ${assistant1.length}. assistant2: ${assistant2.length} (+2 spaces)`)

  console.log("\n1. WARM-UP:")
  const w = await call(warmUp)
  console.log(`   hit=${w.hit} miss=${w.miss} ratio=${w.ratio}%`)

  console.log(`\n2. Wait ${WAIT / 1000}s...`)
  await sleep(WAIT)

  console.log("\n3. TEST (assistant with 2 extra spaces):")
  const t = await call(shifted)
  console.log(`   hit=${t.hit} miss=${t.miss} ratio=${t.ratio}%`)

  if (t.hit > 0 && t.hit < w.hit) {
    console.log(`\n  → Partial hit: system + user[0] cached. Assistant spaces broke chain. user[1] missed.`)
  } else if (t.hit === 0) {
    console.log(`\n  → Spaces killed ALL cache. Even 2 bytes shift everything.`)
  } else if (t.hit >= w.hit) {
    console.log(`\n  → Spaces did NOT affect cache. DeepSeek may normalize whitespace.`)
  }
}

// ── Test E: Partial fact replacement ───────────────────────────────────────

async function testE() {
  console.log("\n" + "=".repeat(60))
  console.log("TEST E: Replace fact_05, keep 19 facts identical — do they survive?")
  console.log("=".repeat(60))

  const facts = makeFacts(20)
  const question = "\n\nQuestion: summarize the stack."

  // All facts same except fact_05 changed
  const changedFacts = [...facts]
  changedFacts[4] = "- fact_05: This component now handles REALTIME STREAMING for the project." // CHANGED

  console.log("\n1. WARM-UP (original facts):")
  const w = await call(msg(SYSTEM, facts.join("\n") + question))
  console.log(`   hit=${w.hit} miss=${w.miss} ratio=${w.ratio}%`)

  console.log(`\n2. Wait ${WAIT / 1000}s...`)
  await sleep(WAIT)

  console.log("\n3. SAME facts, different question (baseline):")
  const base = await call(msg(SYSTEM, facts.join("\n") + "\n\nQuestion: count the facts."))
  console.log(`   hit=${base.hit} miss=${base.miss} ratio=${base.ratio}% (baseline — all identical)`)

  await sleep(1000)

  console.log("\n4. fact_05 CHANGED, rest identical:")
  const t = await call(msg(SYSTEM, changedFacts.join("\n") + question))
  console.log(`   hit=${t.hit} miss=${t.miss} ratio=${t.ratio}%`)

  // Analysis
  if (t.hit > 0 && t.hit < base.hit) {
    console.log(`\n  → PARTIAL HIT: facts 01-04 hit (before change). Change at 05 broke chain.`)
    console.log(`    Lost ${base.hit - t.hit} cache tokens from the divergence at fact_05.`)
    console.log(`    Facts 06-20 did NOT hit — confirm prefix chain is sequential.`)
  } else if (t.hit === base.hit) {
    console.log(`\n  → ALL HIT: DeepSeek cached unchanged facts despite divergence at 05.`)
    console.log(`    CONFIRMED: Facts area can survive partial changes!`)
  } else if (t.hit === 0) {
    console.log(`\n  → ALL MISS: Changed fact killed entire cache chain.`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Position Cache Tests B-E\n")

  console.log("── TEST B ──")
  await testB()

  console.log("\n── TEST C ──")
  await testC()

  console.log("\n── TEST D ──")
  await testD()

  console.log("\n── TEST E ──")
  await testE()

  console.log("\n[DONE] All position tests complete.")
}

main().catch(e => { console.error(e); process.exit(1) })
