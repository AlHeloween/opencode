/**
 * Multi-provider model status — standardised display for provider-specific
 * account state: credit balance (DeepSeek, OpenRouter), usage windows (OpenAI),
 * or unavailable.
 *
 * Supported providers:
 *   - deepseek:   balance via GET https://api.deepseek.com/user/balance
 *   - openrouter: balance via GET https://openrouter.ai/api/v1/credits
 *
 * Providers without a registered handler return { type: "unavailable" }.
 */
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "provider.status" })

// ─── Model Status Types ──────────────────────────────────────────────────

/** Credit-account balance display. */
export interface StatusBalance {
  type: "balance"
  currency: string
  totalBalance: string
  isAvailable: boolean
}

/** Time-window usage display (e.g. OpenAI Codex 5h / weekly). */
export interface StatusUsage {
  type: "usage"
  windows: StatusUsageWindow[]
}

export interface StatusUsageWindow {
  label: string        // e.g. "5h", "Weekly"
  usedPercent: number  // 0-100
  resetAt: number      // unix timestamp (0 if unknown)
}

/** Provider not supported or no auth configured. */
export interface StatusUnavailable {
  type: "unavailable"
  reason: "no_handler" | "no_api_key" | "api_error" | "needs_codex_auth"
}

export type ModelStatus = StatusBalance | StatusUsage | StatusUnavailable

// ─── Balance Snapshot (internal cost validation, unchanged) ──────────────

export interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface BalanceResponse {
  isAvailable: boolean
  balanceInfos: BalanceInfo[]
}

export interface BalanceSnapshot {
  id: string
  providerID: string
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
  isAvailable: boolean
  sessionID?: string
  messageID?: string
  calculatedCostSinceLast?: number
  actualBalanceDelta?: number
  costValidationDelta?: number
  timeCreated: number
}

// ─── Status Fetcher Registry ─────────────────────────────────────────────

type StatusFetcher = (apiKey: string) => Promise<ModelStatus>

const statusFetcherRegistry: Record<string, StatusFetcher> = {
  deepseek: fetchDeepSeekStatus,
  openrouter: fetchOpenRouterStatus,
}

// ─── DeepSeek ────────────────────────────────────────────────────────────

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance"

async function fetchDeepSeekStatus(apiKey: string): Promise<ModelStatus> {
  const response = await fetch(DEEPSEEK_BALANCE_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`DeepSeek status API returned ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    is_available: boolean
    balance_infos: Array<{
      currency: string
      total_balance: string
      granted_balance: string
      topped_up_balance: string
    }>
  }

  const usd = (data.balance_infos ?? []).find((b) => b.currency === "USD")
    ?? data.balance_infos?.[0]

  if (!usd) {
    return { type: "unavailable", reason: "api_error" }
  }

  return {
    type: "balance",
    currency: usd.currency,
    totalBalance: usd.total_balance,
    isAvailable: data.is_available,
  }
}

// ─── OpenRouter ──────────────────────────────────────────────────────────

const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"

async function fetchOpenRouterStatus(apiKey: string): Promise<ModelStatus> {
  const response = await fetch(OPENROUTER_CREDITS_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`OpenRouter status API returned ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    data: { total_credits: number; total_usage: number }
  }

  const totalCredits = data.data?.total_credits ?? 0
  const totalUsage = data.data?.total_usage ?? 0
  const remaining = totalCredits - totalUsage

  return {
    type: "balance",
    currency: "USD",
    totalBalance: String(remaining),
    isAvailable: remaining > 0,
  }
}

// ─── Auth Helpers ────────────────────────────────────────────────────────

async function getProviderApiKey(providerID: string): Promise<string | undefined> {
  const path = await import("path")
  const Global = await import("@opencode-ai/core/global")
  const fs = await import("fs/promises")

  const authPath = path.join(Global.Global.Path.config, "auth.json")
  try {
    const raw = await fs.readFile(authPath, "utf-8")
    const data = JSON.parse(raw) as Record<string, { type: string; key?: string }>
    const entry = data[providerID]
    if (entry?.type === "api" && entry.key) {
      return entry.key
    }
  } catch {
    // auth.json not found or unreadable
  }
  return undefined
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Get the standardised model status for a provider.
 * Returns { type: "unavailable" } if no handler, no key, or fetch failure.
 */
export async function getModelStatus(providerID: string): Promise<ModelStatus> {
  const fetcher = statusFetcherRegistry[providerID]
  if (!fetcher) {
    log.debug("status check skipped — no handler", { providerID })
    return { type: "unavailable", reason: "no_handler" }
  }

  const apiKey = await getProviderApiKey(providerID)
  if (!apiKey) {
    log.debug("status check skipped — no API key", { providerID })
    return { type: "unavailable", reason: "no_api_key" }
  }

  try {
    return await fetcher(apiKey)
  } catch (err) {
    log.warn("bug: status fetch failed", { providerID, error: String(err) })
    return { type: "unavailable", reason: "api_error" }
  }
}

// ─── Legacy: Balance Snapshot (for cost validation in processor) ─────────

/** Used by checkAndSnapshotBalance in processor.ts for cost-delta tracking. */
export async function checkBalance(params: {
  providerID: string
  sessionID?: string
  messageID?: string
  previousSnapshot?: { totalBalance: string }
  calculatedCostSinceLast?: number
}): Promise<BalanceSnapshot | null> {
  const fetcher = statusFetcherRegistry[params.providerID]
  if (!fetcher) return null

  const apiKey = await getProviderApiKey(params.providerID)
  if (!apiKey) return null

  let status: ModelStatus
  try {
    status = await fetcher(apiKey)
  } catch {
    return null
  }

  // Only balance-type status can produce a snapshot for cost validation
  if (status.type !== "balance") return null

  const total = status.totalBalance

  let actualBalanceDelta: number | undefined
  let costValidationDelta: number | undefined

  if (params.previousSnapshot && params.calculatedCostSinceLast !== undefined) {
    const prevTotal = Number.parseFloat(params.previousSnapshot.totalBalance)
    const currTotal = Number.parseFloat(total)
    if (Number.isFinite(prevTotal) && Number.isFinite(currTotal)) {
      actualBalanceDelta = prevTotal - currTotal
      costValidationDelta = actualBalanceDelta - params.calculatedCostSinceLast
    }
  }

  return {
    id: `bs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerID: params.providerID,
    currency: status.currency,
    totalBalance: total,
    grantedBalance: "0",
    toppedUpBalance: "0",
    isAvailable: status.isAvailable,
    sessionID: params.sessionID,
    messageID: params.messageID,
    calculatedCostSinceLast: params.calculatedCostSinceLast,
    actualBalanceDelta,
    costValidationDelta,
    timeCreated: Date.now(),
  }
}
