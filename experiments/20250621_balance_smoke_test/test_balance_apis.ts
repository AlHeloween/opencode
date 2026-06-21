/**
 * Smoke test: Verify provider balance API endpoints work as documented.
 * Reads auth.json from the same path the app uses, calls each provider's
 * balance endpoint, and reports results without exposing API keys.
 *
 * Usage: bun run experiments/20250621_balance_smoke_test/test_balance_apis.ts
 */

import * as fs from "node:fs"
import * as path from "node:path"

// ─── Configuration ───────────────────────────────────────────────────────
const AUTH_PATH = "D:/zPython/opencode/bin/auth.json"
const OUTPUT_PATH = "D:/zPython/opencode/experiments/20250621_balance_smoke_test/results.json"

interface AuthEntry {
  type: string
  key?: string
  metadata?: Record<string, string>
}

interface BalanceTestResult {
  provider: string
  endpoint: string
  success: boolean
  statusCode?: number
  responseShape?: Record<string, unknown>
  parsedBalance?: {
    currency: string
    totalBalance: string
    isAvailable: boolean
  } | null
  error?: string
  rawResponsePreview?: string
  durationMs: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function loadAuth(): Record<string, AuthEntry> {
  const raw = fs.readFileSync(AUTH_PATH, "utf-8")
  return JSON.parse(raw) as Record<string, AuthEntry>
}

function maskKey(key: string): string {
  if (key.length <= 7) return "***"
  return key.slice(0, 4) + "..." + key.slice(-4)
}

async function testEndpoint(
  url: string,
  apiKey: string,
  provider: string,
  parseFn: (json: any) => { currency: string; totalBalance: string; isAvailable: boolean } | null,
): Promise<BalanceTestResult> {
  const start = performance.now()
  const result: BalanceTestResult = {
    provider,
    endpoint: url,
    success: false,
    durationMs: 0,
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    })

    result.statusCode = response.status
    result.durationMs = Math.round(performance.now() - start)

    const text = await response.text()
    result.rawResponsePreview = text.slice(0, 500)

    if (!response.ok) {
      result.error = `HTTP ${response.status}: ${text.slice(0, 200)}`
      return result
    }

    const json = JSON.parse(text)
    result.responseShape = Object.keys(json).reduce(
      (acc, k) => {
        const v = json[k]
        acc[k] = typeof v === "object" ? Object.keys(v).join(", ") : typeof v
        return acc
      },
      {} as Record<string, string>,
    )

    const parsed = parseFn(json)
    if (parsed) {
      result.success = true
      result.parsedBalance = parsed
    } else {
      result.error = "Parse function returned null — unexpected response shape"
    }

    return result
  } catch (err: any) {
    result.durationMs = Math.round(performance.now() - start)
    result.error = err.message ?? String(err)
    return result
  }
}

// ─── Provider-Specific Parsers ──────────────────────────────────────────

function parseDeepSeekBalance(json: any) {
  const info = json.balance_infos?.[0]
  if (!info) return null
  return {
    currency: info.currency ?? "USD",
    totalBalance: info.total_balance ?? "0",
    isAvailable: json.is_available ?? false,
  }
}

function parseOpenRouterKey(json: any) {
  const data = json.data
  if (!data) return null
  // limit_remaining is the practical spendable credit
  const remaining = data.limit_remaining ?? data.limit - (data.usage ?? 0)
  return {
    currency: "USD",
    totalBalance: String(remaining),
    isAvailable: remaining > 0,
  }
}

function parseOpenRouterCredits(json: any) {
  const data = json.data
  if (!data) return null
  const total = data.total_credits ?? 0
  const usage = data.total_usage ?? 0
  const remaining = total - usage
  return {
    currency: "USD",
    totalBalance: String(remaining),
    isAvailable: remaining > 0,
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=" .repeat(70))
  console.log("Provider Balance API Smoke Test")
  console.log("=" .repeat(70))

  const auth = loadAuth()
  const results: BalanceTestResult[] = []

  // ── DeepSeek (control — known working) ──────────────────────────────
  const deepseekKey = auth.deepseek?.key
  if (deepseekKey) {
    console.log(`\n[1/4] Testing DeepSeek balance... (key: ${maskKey(deepseekKey)})`)
    const r = await testEndpoint(
      "https://api.deepseek.com/user/balance",
      deepseekKey,
      "deepseek",
      parseDeepSeekBalance,
    )
    results.push(r)
    console.log(`  Status: ${r.success ? "OK" : "FAIL"}`)
    if (r.parsedBalance) {
      console.log(`  Balance: ${r.parsedBalance.totalBalance} ${r.parsedBalance.currency} (available: ${r.parsedBalance.isAvailable})`)
    }
    if (r.error) console.log(`  Error: ${r.error}`)
  } else {
    console.log("\n[1/4] DeepSeek: SKIPPED (no key)")
    results.push({ provider: "deepseek", endpoint: "N/A", success: false, error: "No API key configured", durationMs: 0 })
  }

  // ── OpenRouter /api/v1/key (primary — works with regular API key) ──
  const openrouterKey = auth.openrouter?.key
  if (openrouterKey) {
    console.log(`\n[2/4] Testing OpenRouter /api/v1/key... (key: ${maskKey(openrouterKey)})`)
    const r = await testEndpoint(
      "https://openrouter.ai/api/v1/key",
      openrouterKey,
      "openrouter",
      parseOpenRouterKey,
    )
    results.push(r)
    console.log(`  Status: ${r.success ? "OK" : "FAIL"}`)
    if (r.parsedBalance) {
      console.log(`  Remain: ${r.parsedBalance.totalBalance} ${r.parsedBalance.currency} (available: ${r.parsedBalance.isAvailable})`)
    }
    if (r.error) console.log(`  Error: ${r.error}`)
    if (r.responseShape) console.log(`  Shape: ${JSON.stringify(r.responseShape)}`)
  } else {
    console.log("\n[2/4] OpenRouter: SKIPPED (no key)")
    results.push({ provider: "openrouter", endpoint: "N/A", success: false, error: "No API key configured", durationMs: 0 })
  }

  // ── OpenRouter /api/v1/credits (needs management key) ───────────────
  if (openrouterKey) {
    console.log(`\n[3/4] Testing OpenRouter /api/v1/credits (management key only)...`)
    const r = await testEndpoint(
      "https://openrouter.ai/api/v1/credits",
      openrouterKey,
      "openrouter-credits",
      parseOpenRouterCredits,
    )
    results.push(r)
    console.log(`  Status: ${r.success ? "OK" : "FAIL"}`)
    if (r.parsedBalance) {
      console.log(`  Credits: ${r.parsedBalance.totalBalance} ${r.parsedBalance.currency}`)
    }
    if (r.error) console.log(`  Error: ${r.error}`)
  }

  // ── OpenCode Zen/Go — try to find balance endpoints ─────────────────
  // These run through the console platform. Try a few common patterns.
  const opencodeKey = auth.opencode?.key
  const opencodeGoKey = auth["opencode-go"]?.key

  console.log(`\n[4/4] Testing OpenCode Zen/Go balance endpoints...`)

  // Try: GET /zen/v1/balance (hypothetical endpoint)
  if (opencodeKey) {
    console.log(`  Trying /zen/v1/balance...`)
    const r = await testEndpoint(
      "https://zen.opencode.ai/zen/v1/balance",
      opencodeKey,
      "opencode-zen",
      (json) => {
        // We don't know the response shape — try common patterns
        if (json.balance !== undefined) {
          return { currency: "USD", totalBalance: String(json.balance), isAvailable: json.balance > 0 }
        }
        if (json.data?.balance !== undefined) {
          return { currency: "USD", totalBalance: String(json.data.balance), isAvailable: json.data.balance > 0 }
        }
        return null
      },
    )
    results.push(r)
    console.log(`    Status: ${r.statusCode ?? "ERR"}, ${r.success ? "parsed OK" : "no balance found"}`)
    if (r.rawResponsePreview) console.log(`    Response preview: ${r.rawResponsePreview.slice(0, 150)}`)
  }

  if (opencodeGoKey) {
    console.log(`  Trying /zen/go/v1/balance...`)
    const r = await testEndpoint(
      "https://zen.opencode.ai/zen/go/v1/balance",
      opencodeGoKey,
      "opencode-go",
      (json) => {
        if (json.balance !== undefined) {
          return { currency: "USD", totalBalance: String(json.balance), isAvailable: json.balance > 0 }
        }
        if (json.data?.balance !== undefined) {
          return { currency: "USD", totalBalance: String(json.data.balance), isAvailable: json.data.balance > 0 }
        }
        return null
      },
    )
    results.push(r)
    console.log(`    Status: ${r.statusCode ?? "ERR"}, ${r.success ? "parsed OK" : "no balance found"}`)
    if (r.rawResponsePreview) console.log(`    Response preview: ${r.rawResponsePreview.slice(0, 150)}`)
  }

  // ── Write results ──────────────────────────────────────────────────
  // Strip raw response previews (may contain sensitive info) for the file
  const safeResults = results.map(({ rawResponsePreview, ...rest }) => rest)
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(safeResults, null, 2))

  // ── Summary ────────────────────────────────────────────────────────
  console.log("\n" + "=" .repeat(70))
  console.log("SUMMARY")
  console.log("=" .repeat(70))
  for (const r of results) {
    const status = r.success ? "PASS" : r.error ? "FAIL" : "SKIP"
    const balance = r.parsedBalance
      ? `${r.parsedBalance.totalBalance} ${r.parsedBalance.currency}`
      : r.error
        ? r.error.slice(0, 60)
        : "N/A"
    console.log(`  ${status.padEnd(6)} | ${r.provider.padEnd(20)} | ${balance}`)
  }
  console.log(`\nFull results: ${OUTPUT_PATH}`)
}

main().catch(console.error)
