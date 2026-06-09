/**
 * Phase 1: Cache Stability Baseline
 *
 * Measures real DeepSeek cache behavior using prompt_cache_hit_tokens
 * and prompt_cache_miss_tokens from the API response.
 *
 * Key test: Does "Today's date" in the system prompt KILL cache for
 * subsequent conversation tokens?
 *
 * Usage: cd packages/opencode && bun run test/experiments/20260610_cache_guardrail/phase1_baseline.ts
 */

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) {
  console.error("DEEPSEEK_API_KEY not set")
  process.exit(1)
}

const BASE_URL = "https://api.deepseek.com/v1"
const MODEL = "deepseek-chat"
const MAX_TOKENS = 100
const CACHE_PERSIST_MS = 5000 // DeepSeek docs say "seconds"

// ── Types ──────────────────────────────────────────────────────────────────

interface CacheResult {
  test: string
  hitTokens: number
  missTokens: number
  totalPromptTokens: number
  hitRatio: number
  firstTokenMs: number
  totalMs: number
  outputText: string
  error?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildRequestBody(messages: Array<{ role: string; content: string }>) {
  return {
    model: MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    stream: false,
  }
}

async function callDeepSeek(
  messages: Array<{ role: string; content: string }>,
): Promise<{ response: any; firstTokenMs: number; totalMs: number }> {
  const start = Date.now()
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(buildRequestBody(messages)),
  })

  const totalMs = Date.now() - start
  const json = await res.json()
  const firstTokenMs = totalMs // non-streaming: first token ≈ total time

  if (!res.ok) {
    return { response: json, firstTokenMs, totalMs }
  }

  return {
    response: json,
    firstTokenMs,
    totalMs,
  }
}

function extractCacheMetrics(response: any): { hit: number; miss: number; total: number } {
  const usage = response.usage
  if (!usage) return { hit: 0, miss: 0, total: 0 }

  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? usage.prompt_tokens ?? 0
  const total = hit + miss

  return { hit, miss, total }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Test Scenarios ─────────────────────────────────────────────────────────

async function test_date_kills_cache(): Promise<CacheResult[]> {
  console.log("\n" + "=" .repeat(60))
  console.log("TEST 1: Does date in system prompt kill cache?")
  console.log("=" .repeat(60))

  const results: CacheResult[] = []

  const systemBase = [
    "You are a helpful assistant.",
    "Current environment: TypeScript, Node.js, Linux.",
  ]

  const systemDateJune9 = `Today's date: June 9, 2026.`
  const systemDateJune10 = `Today's date: June 10, 2026.`

  const stablePrefix = [
    "Here is some context about a project:",
    "The project is a TypeScript web application that uses Express for the backend.",
    "It has authentication middleware and a PostgreSQL database.",
    "The frontend uses React with TypeScript and Tailwind CSS.",
    "There are 42 API endpoints for CRUD operations on 8 database tables.",
    "The project has 15,000 lines of TypeScript code across 120 files.",
    "CI/CD is configured with GitHub Actions for testing and deployment.",
    "The Docker setup uses multi-stage builds for optimized image sizes.",
  ]

  const question1 = "\n\nQuestion: What technology stack does this project use? List them."

  // Step 1: Warm-up request (establishes cache)
  console.log("\n1. WARM-UP: Sending initial request to establish cache...")
  const warmUpMessages = [
    { role: "system", content: [systemBase.join("\n"), systemDateJune9].join("\n") },
    ...stablePrefix.map((line) => ({ role: "system" as const, content: line })),
    { role: "user", content: question1 },
  ]

  const warmResult = await callDeepSeek(warmUpMessages)
  if (warmResult.response.error) {
    console.error(`   ERROR: ${JSON.stringify(warmResult.response.error)}`)
    return results
  }
  const warmMetrics = extractCacheMetrics(warmResult.response)
  console.log(`   Hit tokens: ${warmMetrics.hit} | Miss tokens: ${warmMetrics.miss} | Time: ${warmResult.totalMs}ms`)
  console.log(`   Output: "${warmResult.response.choices?.[0]?.message?.content?.substring(0, 80)}..."`)

  // Step 2: Wait for cache to persist
  console.log(`\n2. Waiting ${CACHE_PERSIST_MS / 1000}s for cache persistence...`)
  await sleep(CACHE_PERSIST_MS)

  // Step 3: Same date, different question (should HIT cache for prefix)
  console.log("\n3. SAME date, DIFFERENT question (should hit prefix cache)...")
  const question2 = "\n\nQuestion: How many API endpoints does the project have?"

  const sameDateMessages = [
    { role: "system", content: [systemBase.join("\n"), systemDateJune9].join("\n") },
    ...stablePrefix.map((line) => ({ role: "system" as const, content: line })),
    { role: "user", content: question2 },
  ]

  const sameDateResult = await callDeepSeek(sameDateMessages)
  const sameDateMetrics = extractCacheMetrics(sameDateResult.response)
  results.push({
    test: "same_date_diff_question",
    hitTokens: sameDateMetrics.hit,
    missTokens: sameDateMetrics.miss,
    totalPromptTokens: sameDateMetrics.total,
    hitRatio: sameDateMetrics.total > 0 ? sameDateMetrics.hit / sameDateMetrics.total : 0,
    firstTokenMs: sameDateResult.firstTokenMs,
    totalMs: sameDateResult.totalMs,
    outputText: sameDateResult.response.choices?.[0]?.message?.content ?? "",
  })
  console.log(`   Hit: ${sameDateMetrics.hit} | Miss: ${sameDateMetrics.miss} | Total: ${sameDateMetrics.total}`)
  console.log(`   Hit ratio: ${(sameDateMetrics.hit / Math.max(1, sameDateMetrics.total) * 100).toFixed(1)}%`)
  console.log(`   Time: ${sameDateResult.totalMs}ms`)
  console.log(`   Output: "${sameDateResult.response.choices?.[0]?.message?.content?.substring(0, 80)}..."`)
  console.log(`   PASSED: ${sameDateMetrics.hit > 0}`)

  await sleep(1000)

  // Step 4: Different date, same everything else (should MISS cache)
  console.log("\n4. DIFFERENT date, same prefix + question (should miss cache)...")

  const diffDateMessages = [
    { role: "system", content: [systemBase.join("\n"), systemDateJune10].join("\n") },
    ...stablePrefix.map((line) => ({ role: "system" as const, content: line })),
    { role: "user", content: question2 },
  ]

  const diffDateResult = await callDeepSeek(diffDateMessages)
  const diffDateMetrics = extractCacheMetrics(diffDateResult.response)
  results.push({
    test: "diff_date_same_everything",
    hitTokens: diffDateMetrics.hit,
    missTokens: diffDateMetrics.miss,
    totalPromptTokens: diffDateMetrics.total,
    hitRatio: diffDateMetrics.total > 0 ? diffDateMetrics.hit / diffDateMetrics.total : 0,
    firstTokenMs: diffDateResult.firstTokenMs,
    totalMs: diffDateResult.totalMs,
    outputText: diffDateResult.response.choices?.[0]?.message?.content ?? "",
  })
  console.log(`   Hit: ${diffDateMetrics.hit} | Miss: ${diffDateMetrics.miss} | Total: ${diffDateMetrics.total}`)
  console.log(`   Hit ratio: ${(diffDateMetrics.hit / Math.max(1, diffDateMetrics.total) * 100).toFixed(1)}%`)
  console.log(`   Time: ${diffDateResult.totalMs}ms`)
  console.log(`   Output: "${diffDateResult.response.choices?.[0]?.message?.content?.substring(0, 80)}..."`)

  // Compare: date change should reduce hit tokens
  if (sameDateMetrics.hit > diffDateMetrics.hit) {
    console.log(`   VERDICT: Date change KILLED ${sameDateMetrics.hit - diffDateMetrics.hit} hit tokens (${sameDateMetrics.hit} → ${diffDateMetrics.hit}). CONFIRMED.`)
  } else if (sameDateMetrics.hit > 0 && diffDateMetrics.hit > 0 && sameDateMetrics.hit === diffDateMetrics.hit) {
    console.log(`   VERDICT: Date change did NOT affect cache. DeepSeek may detect common prefix despite date change.`)
  } else {
    console.log(`   VERDICT: Both have 0 hit tokens. Cache may not have persisted yet.`)
  }

  return results
}

async function test_prefix_length_effect(): Promise<CacheResult[]> {
  console.log("\n" + "=" .repeat(60))
  console.log("TEST 2: How does prefix length affect cache hits?")
  console.log("=" .repeat(60))

  const results: CacheResult[] = []

  const system = "You are a helpful assistant. Answer briefly."

  const prefixLengths = [0, 200, 500, 1000]
  const prefix = "A" .repeat(2000) // dummy padding to build prefix of desired length

  for (const len of prefixLengths) {
    const shortPrefix = prefix.substring(0, len)

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: system },
    ]

    if (shortPrefix.length > 0) {
      messages.push({ role: "system", content: `[CONTEXT START] ${shortPrefix} [CONTEXT END]` })
    }

    messages.push({ role: "user", content: "Say 'hello' in one word." })

    console.log(`\n  Prefix length: ${len} chars`)
    const result = await callDeepSeek(messages)
    const metrics = extractCacheMetrics(result.response)

    results.push({
      test: `prefix_${len}`,
      hitTokens: metrics.hit,
      missTokens: metrics.miss,
      totalPromptTokens: metrics.total,
      hitRatio: metrics.total > 0 ? metrics.hit / metrics.total : 0,
      firstTokenMs: result.firstTokenMs,
      totalMs: result.totalMs,
      outputText: result.response.choices?.[0]?.message?.content ?? "",
    })

    console.log(`    Hit: ${metrics.hit} | Miss: ${metrics.miss} | Time: ${result.totalMs}ms`)
    await sleep(1000)
  }

  return results
}

async function test_cold_vs_warm(): Promise<CacheResult[]> {
  console.log("\n" + "=" .repeat(60))
  console.log("TEST 3: Cold start vs warm cache latency")
  console.log("=" .repeat(60))

  const results: CacheResult[] = []

  const system = "You are a helpful assistant. Answer briefly."
  const longPrefix = "Here is detailed context:" + "A" .repeat(3000) + "\nEnd of context."

  const question = "\n\nQuestion: What shape is the earth?"

  const messages = [
    { role: "system", content: system },
    { role: "system", content: longPrefix },
    { role: "user", content: question },
  ]

  // Cold start
  console.log("\n  COLD: First request (no cache baseline)")
  const cold = await callDeepSeek(messages)
  const coldMetrics = extractCacheMetrics(cold.response)
  results.push({
    test: "cold_start",
    hitTokens: coldMetrics.hit,
    missTokens: coldMetrics.miss,
    totalPromptTokens: coldMetrics.total,
    hitRatio: coldMetrics.total > 0 ? coldMetrics.hit / coldMetrics.total : 0,
    firstTokenMs: cold.firstTokenMs,
    totalMs: cold.totalMs,
    outputText: cold.response.choices?.[0]?.message?.content ?? "",
  })
  console.log(`    Hit: ${coldMetrics.hit} | Miss: ${coldMetrics.miss} | Time: ${cold.totalMs}ms`)

  console.log(`\n  Waiting ${CACHE_PERSIST_MS / 1000}s for cache to persist...`)
  await sleep(CACHE_PERSIST_MS)

  // Warm: same request
  console.log("\n  WARM: Same request (should hit cache)")
  const warm = await callDeepSeek(messages)
  const warmMetrics = extractCacheMetrics(warm.response)
  results.push({
    test: "warm_cache",
    hitTokens: warmMetrics.hit,
    missTokens: warmMetrics.miss,
    totalPromptTokens: warmMetrics.total,
    hitRatio: warmMetrics.total > 0 ? warmMetrics.hit / warmMetrics.total : 0,
    firstTokenMs: warm.firstTokenMs,
    totalMs: warm.totalMs,
    outputText: warm.response.choices?.[0]?.message?.content ?? "",
  })
  console.log(`    Hit: ${warmMetrics.hit} | Miss: ${warmMetrics.miss} | Time: ${warm.totalMs}ms`)

  const speedup = cold.totalMs - warm.totalMs
  console.log(`    Speedup: ${speedup}ms (${(speedup / cold.totalMs * 100).toFixed(1)}% faster)`)

  return results
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=" .repeat(60))
  console.log("Phase 1: DeepSeek Cache Stability Baseline")
  console.log("=" .repeat(60))
  console.log(`Model: ${MODEL}`)
  console.log(`API Key: ${API_KEY!.substring(0, 8)}...`)
  console.log()

  const allResults: CacheResult[] = []

  // Test 1: Date kills cache (the critical hypothesis)
  const dateResults = await test_date_kills_cache()
  allResults.push(...dateResults)

  // Test 2: Prefix length effect
  // const prefixResults = await test_prefix_length_effect()
  // allResults.push(...prefixResults)

  // Test 3: Cold vs warm
  // const coldWarmResults = await test_cold_vs_warm()
  // allResults.push(...coldWarmResults)

  // Summary
  console.log("\n" + "=" .repeat(60))
  console.log("SUMMARY")
  console.log("=" .repeat(60))

  if (allResults.length === 0) {
    console.log("No results collected. Check API errors above.")
    return
  }

  console.log("\n| Test | Hit | Miss | Total | Ratio | Time |")
  console.log("|------|-----|------|-------|-------|------|")
  for (const r of allResults) {
    console.log(`| ${r.test.padEnd(26)} | ${String(r.hitTokens).padStart(4)} | ${String(r.missTokens).padStart(5)} | ${String(r.totalPromptTokens).padStart(5)} | ${(r.hitRatio * 100).toFixed(0).padStart(4)}% | ${String(r.totalMs).padStart(4)}ms |`)
  }

  // The critical verdict
  const sameDate = allResults.find((r) => r.test === "same_date_diff_question")
  const diffDate = allResults.find((r) => r.test === "diff_date_same_everything")

  if (sameDate && diffDate) {
    console.log("\n── VERDICT ──")
    console.log(`  Same date: ${sameDate.hitTokens} hit tokens`)
    console.log(`  Diff date: ${diffDate.hitTokens} hit tokens`)
    if (sameDate.hitTokens > diffDate.hitTokens) {
      console.log(`  CONFIRMED: Date change reduces cache hits by ${sameDate.hitTokens - diffDate.hitTokens} tokens`)
      console.log(`  The date in the system prompt KILLS provider cache for subsequent tokens.`)
    } else if (sameDate.hitTokens === 0 && diffDate.hitTokens === 0) {
      console.log(`  INCONCLUSIVE: No cache hits in either case. Cache may need more time to persist.`)
    } else {
      console.log(`  UNEXPECTED: Date change did not affect cache. DeepSeek may detect common prefix.`)
    }
  }
}

main().catch(console.error)
