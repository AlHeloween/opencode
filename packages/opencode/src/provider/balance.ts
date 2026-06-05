/**
 * DeepSeek balance checking — queries the /user/balance API, stores snapshots,
 * and cross-validates our calculated costs against real balance deltas.
 *
 * API docs: https://api-docs.deepseek.com/api/get-user-balance
 *
 * Response shape:
 *   GET /user/balance
 *   { is_available: boolean, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
 */
import * as Log from "@opencode-ai/core/util/log"
import { Auth } from "@/auth"

const log = Log.create({ service: "provider.balance" })

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

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance"

/**
 * Fetch the current balance from the DeepSeek API.
 * Uses the stored API key from auth.json.
 */
export async function fetchDeepSeekBalance(apiKey: string): Promise<BalanceResponse> {
  const response = await fetch(DEEPSEEK_BALANCE_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`DeepSeek balance API returned ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = await response.json() as {
    is_available: boolean
    balance_infos: Array<{
      currency: string
      total_balance: string
      granted_balance: string
      topped_up_balance: string
    }>
  }

  return {
    isAvailable: data.is_available,
    balanceInfos: (data.balance_infos ?? []).map((b) => ({
      currency: b.currency,
      totalBalance: b.total_balance,
      grantedBalance: b.granted_balance,
      toppedUpBalance: b.topped_up_balance,
    })),
  }
}

/**
 * Helper to get the DeepSeek API key from the auth store.
 * Returns undefined if no API key is configured.
 */
export async function getDeepSeekApiKey(): Promise<string | undefined> {
  // Read auth.json directly — this runs outside Effect context for simplicity
  const path = await import("path")
  const Global = await import("@opencode-ai/core/global")
  const fs = await import("fs/promises")

  const authPath = path.join(Global.Global.Path.config, "auth.json")
  try {
    const raw = await fs.readFile(authPath, "utf-8")
    const data = JSON.parse(raw) as Record<string, { type: string; key?: string }>
    const deepseek = data["deepseek"]
    if (deepseek?.type === "api" && deepseek.key) {
      return deepseek.key
    }
  } catch {
    // auth.json not found or unreadable — no API key available
  }
  return undefined
}

/**
 * Fetch balance and return a snapshot object ready for DB insertion.
 * Returns null if the API key is not configured or the request fails.
 */
export async function checkBalance(params: {
  providerID: string
  sessionID?: string
  messageID?: string
  previousSnapshot?: { totalBalance: string }
  calculatedCostSinceLast?: number
}): Promise<BalanceSnapshot | null> {
  if (params.providerID !== "deepseek") {
    log.debug("balance check skipped — unsupported provider", { providerID: params.providerID })
    return null
  }

  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    log.debug("balance check skipped — no API key configured for deepseek")
    return null
  }

  let balance: BalanceResponse
  try {
    balance = await fetchDeepSeekBalance(apiKey)
  } catch (err) {
    log.warn("bug: failed to fetch DeepSeek balance", { error: String(err) })
    return null
  }

  const usdInfo = balance.balanceInfos.find((b) => b.currency === "USD")
    ?? balance.balanceInfos[0]
  if (!usdInfo) {
    log.warn("bug: DeepSeek balance response had no balance_infos")
    return null
  }

  // Compute deltas if we have a previous snapshot
  let actualBalanceDelta: number | undefined
  let costValidationDelta: number | undefined

  if (params.previousSnapshot && params.calculatedCostSinceLast !== undefined) {
    const prevTotal = Number.parseFloat(params.previousSnapshot.totalBalance)
    const currTotal = Number.parseFloat(usdInfo.totalBalance)
    if (Number.isFinite(prevTotal) && Number.isFinite(currTotal)) {
      actualBalanceDelta = prevTotal - currTotal
      costValidationDelta = actualBalanceDelta - params.calculatedCostSinceLast
    }
  }

  return {
    id: `bs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    providerID: params.providerID,
    currency: usdInfo.currency,
    totalBalance: usdInfo.totalBalance,
    grantedBalance: usdInfo.grantedBalance,
    toppedUpBalance: usdInfo.toppedUpBalance,
    isAvailable: balance.isAvailable,
    sessionID: params.sessionID,
    messageID: params.messageID,
    calculatedCostSinceLast: params.calculatedCostSinceLast,
    actualBalanceDelta,
    costValidationDelta,
    timeCreated: Date.now(),
  }
}
