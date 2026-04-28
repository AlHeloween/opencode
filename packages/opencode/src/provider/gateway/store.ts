import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import type { AdjustmentStoreData, RouteAdjustment } from "./adjustment-store"
import {
  initialStore,
  getOrCreateRoute,
  updateStreamingPreference,
  defaultStreamingPreference,
  recordH2Failure as adjustH2Failure,
  recordH1Success as adjustH1Success,
  recordH2Success as adjustH2Success,
  getEffectiveProtocol,
  defaultProtocolPreference,
  adaptPolicy as adaptPolicyFn,
  enforcePolicyFloors,
} from "./adjustment-store"
import * as HealthWindow from "./health-window"
import type { HealthMetrics } from "./health-window"
import * as Log from "@opencode-ai/core/util/log"
import { toRouteKeyString, parseRouteKeyString, type RouteKey } from "./route-key"
import { Effect } from "effect"
import type { AsyncLogger } from "./async-logger"
import { make as makeAsyncLogger } from "./async-logger"
import * as CircuitBreaker from "./circuit-breaker"
import * as RetryBudget from "./retry-budget"

const STORE_FILE = "gateway-adjustments.json"
const POLICY_LOG_FILE = "gateway-policy.log"
const PERSIST_INTERVAL_MS = 30000
const MAX_ROUTES = 500
const MAX_HEALTH_WINDOWS = 500
const MAX_CIRCUIT_BREAKERS = 500
const MAX_RETRY_BUDGETS = 500
const STALE_THRESHOLD_MS = 3600000

const policyLogDir = path.join(Global.Path.data, "gateway")
const policyLogPath = path.join(policyLogDir, POLICY_LOG_FILE)
let policyLogger: AsyncLogger | undefined

function initPolicyLogger() {
  if (!policyLogger) {
    try {
      fsSync.mkdirSync(policyLogDir, { recursive: true })
      policyLogger = makeAsyncLogger({ path: policyLogPath, maxBuffer: 2000, intervalMs: 200 })
    } catch {
      // If we can't create the logger, just skip policy logging
    }
  }
}

function writePolicyLog(entry: {
  event: string
  timestamp: number
  routeKey: string
  provider: string
  model: string
  policy?: unknown
  health?: unknown
  success?: boolean
  score?: number
}): void {
  if (!policyLogger) {
    initPolicyLogger()
    if (!policyLogger) return
  }
  policyLogger.log(entry)
}

const log = Log.create({ prefix: "gateway/store" })

function evictStaleEntries(s: StoreState): void {
  const now = Date.now()
  const maxAgeMs = 3600000
  let evicted = 0

  const staleHealthKeys: string[] = []
  for (const [key, hw] of s.healthWindows) {
    const lastAccess = s.routeLastAccessed.get(key) || 0
    if (now - lastAccess > maxAgeMs) {
      staleHealthKeys.push(key)
    }
  }
  for (const key of staleHealthKeys) {
    s.healthWindows.delete(key)
    s.routeLastAccessed.delete(key)
    evicted++
  }

  if (s.circuitBreakers.size > MAX_CIRCUIT_BREAKERS) {
    const entries: Array<[string, number]> = []
    for (const [key, cb] of s.circuitBreakers) {
      if (cb.openedAt > 0) {
        entries.push([key, cb.openedAt])
      }
    }
    entries.sort((a, b) => a[1] - b[1])
    const toEvict = entries.length - MAX_CIRCUIT_BREAKERS
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      s.circuitBreakers.delete(entries[i][0])
      evicted++
    }
  }

  if (s.retryBudgets.size > MAX_RETRY_BUDGETS) {
    const entries: Array<[string, number]> = []
    for (const [key, budget] of s.retryBudgets) {
      if (budget.totalRequests > 0) {
        entries.push([key, budget.totalRequests])
      }
    }
    entries.sort((a, b) => a[1] - b[1])
    const toEvict = entries.length - MAX_RETRY_BUDGETS
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      s.retryBudgets.delete(entries[i][0])
      evicted++
    }
  }

  if (evicted > 0) {
    s.dirty = true
    log.debug("evicted stale gateway entries", { count: evicted })
  }
}

interface StoreState {
  data: AdjustmentStoreData
  dirty: boolean
  lastPersisted: number
  healthWindows: Map<string, HealthWindow.HealthWindow>
  circuitBreakers: Map<string, CircuitBreaker.CircuitBreaker>
  retryBudgets: Map<string, RetryBudget.RetryBudget>
  routeLastAccessed: Map<string, number>
}

let state: StoreState | null = null
let persistTimer: Timer | null = null

async function load(): Promise<StoreState> {
  const filePath = path.join(Global.Path.data, STORE_FILE)
  try {
    const text = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(text) as AdjustmentStoreData
    if (data.version !== 1) {
      log.info("store version mismatch, using initial store", { version: data.version })
      return {
        data: initialStore(),
        dirty: false,
        lastPersisted: Date.now(),
        healthWindows: new Map(),
        circuitBreakers: new Map(),
        retryBudgets: new Map(),
        routeLastAccessed: new Map(),
      }
    }
    // Normalize: ensure all routes have streamingPreference, protocolPreference, policy bounds, and delayHistory
    for (const route of Object.values(data.routes)) {
      if (!route.streamingPreference) {
        route.streamingPreference = defaultStreamingPreference()
      }
      if (!route.protocolPreference) {
        route.protocolPreference = defaultProtocolPreference()
      }
      route.policy = enforcePolicyFloors(route.policy)
      if (!route.delayHistory) {
        route.delayHistory = []
      }
    }
    return {
      data,
      dirty: false,
      lastPersisted: Date.now(),
      healthWindows: new Map(),
      circuitBreakers: new Map(),
      retryBudgets: new Map(),
      routeLastAccessed: new Map(),
    }
  } catch {
    return {
      data: initialStore(),
      dirty: false,
      lastPersisted: Date.now(),
      healthWindows: new Map(),
      circuitBreakers: new Map(),
      retryBudgets: new Map(),
      routeLastAccessed: new Map(),
    }
  }
}

async function persist(): Promise<void> {
  if (!state || !state.dirty) return

  evictStaleEntries(state)

  const filePath = path.join(Global.Path.data, STORE_FILE)
  const tempPath = filePath + ".tmp"

  const dataToWrite: AdjustmentStoreData = {
    version: 1,
    routes: {},
  }

  for (const [key, adjustment] of Object.entries(state.data.routes)) {
    const hw = state.healthWindows.get(key)
    if (hw) {
      const metrics = HealthWindow.getMetrics(hw)
      dataToWrite.routes[key] = {
        ...adjustment,
        health: metrics,
      }
    } else {
      dataToWrite.routes[key] = adjustment
    }
  }

  const json = await new Promise<string>((resolve) => setImmediate(() => resolve(JSON.stringify(dataToWrite, null, 2))))
  await fs.writeFile(tempPath, json)
  await fs.rename(tempPath, filePath)
  state.dirty = false
  state.lastPersisted = Date.now()
  log.debug("persisted gateway adjustments", { routeCount: Object.keys(dataToWrite.routes).length })
}

function ensureLoaded(): StoreState {
  if (!state) {
    throw new Error("Gateway store not initialized. Call init() first.")
  }
  return state
}

export async function init(): Promise<void> {
  if (state) return
  await fs.mkdir(path.join(Global.Path.data, "gateway"), { recursive: true }).catch(() => {})
  state = await load()

  persistTimer = setInterval(() => {
    if (state && state.dirty) {
      persist().catch((e) => log.error("failed to persist gateway store", { error: e }))
    }
  }, PERSIST_INTERVAL_MS)

  log.info("gateway store initialized", { path: path.join(Global.Path.data, STORE_FILE) })
}

export async function shutdown(): Promise<void> {
  if (persistTimer) {
    clearInterval(persistTimer)
    persistTimer = null
  }
  if (state && state.dirty) {
    await persist()
  }
  state = null
}

export function getRoute(key: RouteKey): RouteAdjustment {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const route = s.data.routes[keyStr]
  s.routeLastAccessed.set(keyStr, Date.now())
  if (!route) {
    if (Object.keys(s.data.routes).length >= MAX_ROUTES) {
      evictStaleEntries(s)
    }
    const now = Date.now()
    const created = getOrCreateRoute(s.data, keyStr, now)
    s.dirty = true
    return created
  }
  if (
    route.policy.minLaunchIntervalMs <= 0 ||
    route.policy.maxInflight <= 0 ||
    route.policy.maxStreams <= 0 ||
    route.policy.minLaunchIntervalMs > 600000
  ) {
    route.policy = enforcePolicyFloors(route.policy)
    s.dirty = true
  }
  return route
}

export function updateRoute(key: RouteKey, adjustment: Partial<RouteAdjustment>): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const existing = s.data.routes[keyStr]
  if (existing) {
    s.data.routes[keyStr] = { ...existing, ...adjustment, updatedAt: Date.now() }
    s.dirty = true
  }
}

export function recordHealth(key: RouteKey, metrics: HealthMetrics): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const existing = s.data.routes[keyStr]
  if (existing) {
    s.data.routes[keyStr] = { ...existing, health: metrics, updatedAt: Date.now() }
    s.dirty = true
  }
}

export function getHealthWindow(key: RouteKey): HealthWindow.HealthWindow {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  let hw = s.healthWindows.get(keyStr)
  if (!hw) {
    hw = HealthWindow.make()
    s.healthWindows.set(keyStr, hw)
  }
  return hw
}

export function recordSuccess(key: RouteKey, latencyMs: number, ttftMs?: number): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  let hw = s.healthWindows.get(keyStr)
  if (!hw) {
    hw = HealthWindow.make()
    s.healthWindows.set(keyStr, hw)
  }
  hw = HealthWindow.recordSuccess(hw)
  if (latencyMs > 0) hw = HealthWindow.recordLatency(hw, latencyMs)
  if (ttftMs !== undefined && ttftMs > 0) hw = HealthWindow.recordTtft(hw, ttftMs)
  s.healthWindows.set(keyStr, hw)
  s.dirty = true

  // Update streaming preference for streaming requests
  if (key.stream) {
    const route = s.data.routes[keyStr]
    if (route) {
      route.streamingPreference = updateStreamingPreference(route.streamingPreference, true, Date.now())
      s.dirty = true
    }
  }

  // Log success event to policy log
  writePolicyLog({
    event: "gateway.policy.success",
    timestamp: Date.now(),
    routeKey: keyStr,
    provider: key.provider,
    model: key.model,
    success: true,
  })
}

export function recordError(key: RouteKey, category: string, latencyMs?: number): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  let hw = s.healthWindows.get(keyStr)
  if (!hw) {
    hw = HealthWindow.make()
    s.healthWindows.set(keyStr, hw)
  }
  hw = HealthWindow.recordError(hw, category, Date.now())
  if (latencyMs !== undefined && latencyMs > 0) hw = HealthWindow.recordLatency(hw, latencyMs)
  s.healthWindows.set(keyStr, hw)
  s.dirty = true

  // Update streaming preference for streaming requests
  if (key.stream) {
    const route = s.data.routes[keyStr]
    if (route) {
      route.streamingPreference = updateStreamingPreference(route.streamingPreference, false, Date.now())
      s.dirty = true
    }
  }

  // Log error event to policy log
  writePolicyLog({
    event: "gateway.policy.error",
    timestamp: Date.now(),
    routeKey: keyStr,
    provider: key.provider,
    model: key.model,
    success: false,
  })
}

export function getStreamingEnabled(key: RouteKey): boolean {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const route = s.data.routes[keyStr]
  if (!route) return true // Default to enabled for new routes
  return route.streamingPreference.enabled
}

export function getAllRoutes(): Array<{ key: RouteKey; adjustment: RouteAdjustment; metrics: HealthMetrics }> {
  const s = ensureLoaded()
  const results: Array<{ key: RouteKey; adjustment: RouteAdjustment; metrics: HealthMetrics }> = []

  for (const [keyStr, adjustment] of Object.entries(s.data.routes)) {
    const parsed = parseRouteKeyString(keyStr)
    if (!parsed) continue

    const hw = s.healthWindows.get(keyStr)
    const metrics = hw ? HealthWindow.getMetrics(hw) : HealthWindow.getMetrics(HealthWindow.make())

    results.push({
      key: parsed,
      adjustment,
      metrics,
    })
  }

  return results
}

export async function forcePersist(): Promise<void> {
  await persist()
}

function getOrCreateCircuitBreaker(state: StoreState, keyStr: string): CircuitBreaker.CircuitBreaker {
  if (!state.circuitBreakers.has(keyStr)) {
    state.circuitBreakers.set(keyStr, CircuitBreaker.make())
  }
  return state.circuitBreakers.get(keyStr)!
}

function getOrCreateRetryBudget(state: StoreState, keyStr: string): RetryBudget.RetryBudget {
  if (!state.retryBudgets.has(keyStr)) {
    state.retryBudgets.set(keyStr, RetryBudget.make())
  }
  return state.retryBudgets.get(keyStr)!
}

export function getCircuitBreakerState(key: RouteKey): CircuitBreaker.CircuitBreaker {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  return getOrCreateCircuitBreaker(s, keyStr)
}

export function recordCircuitBreakerSuccess(key: RouteKey): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const cb = getOrCreateCircuitBreaker(s, keyStr)
  const updated = CircuitBreaker.recordSuccess(cb)
  s.circuitBreakers.set(keyStr, updated)
}

export function recordCircuitBreakerFailure(key: RouteKey): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const cb = getOrCreateCircuitBreaker(s, keyStr)
  const updated = CircuitBreaker.recordFailure(cb)
  s.circuitBreakers.set(keyStr, updated)
}

export function isCircuitBreakerOpen(key: RouteKey): boolean {
  const cb = getCircuitBreakerState(key)
  return !CircuitBreaker.shouldAllowRequest(cb)
}

export function getRetryBudget(key: RouteKey): RetryBudget.RetryBudget {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  return getOrCreateRetryBudget(s, keyStr)
}

export function recordRetryRequest(key: RouteKey): boolean {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const budget = getOrCreateRetryBudget(s, keyStr)
  if (RetryBudget.canRetry(budget)) {
    s.retryBudgets.set(keyStr, RetryBudget.recordRetry(budget))
    return true
  }
  return false
}

export function recordTotalRequest(key: RouteKey): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const budget = getOrCreateRetryBudget(s, keyStr)
  s.retryBudgets.set(keyStr, RetryBudget.recordRequest(budget))
}

export function recordH2Failure(key: RouteKey, reason: string): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const existing = s.data.routes[keyStr]
  if (existing) {
    const updated = adjustH2Failure(existing, reason, Date.now())
    s.data.routes[keyStr] = updated
    s.dirty = true

    writePolicyLog({
      event: "gateway.policy.h2_fallback",
      timestamp: Date.now(),
      routeKey: keyStr,
      provider: key.provider,
      model: key.model,
      policy: {
        preferred: updated.protocolPreference.preferred,
        h2Disabled: updated.protocolPreference.h2Disabled,
        consecutiveFailures: updated.protocolPreference.h2ConsecutiveFailures,
      },
      success: false,
    })
  }
}

export function recordProtocolSuccess(key: RouteKey, protocol: "h2" | "http/1.1"): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const existing = s.data.routes[keyStr]
  if (!existing) return

  const updated = protocol === "h2" ? adjustH2Success(existing, Date.now()) : adjustH1Success(existing, Date.now())

  s.data.routes[keyStr] = updated
  s.dirty = true
}

export function getProtocolPreference(key: RouteKey): "h2" | "http/1.1" {
  const adj = getRoute(key)
  return getEffectiveProtocol(adj)
}

export function shouldProbeH2(key: RouteKey): boolean {
  const adj = getRoute(key)
  const pref = adj.protocolPreference
  if (!pref.h2Disabled) return false

  const now = Date.now()
  return now - pref.lastSwitchAt > 300000
}

export function adaptRoutePolicy(key: RouteKey, success: boolean, score: number): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  const existing = s.data.routes[keyStr]
  if (!existing) return

  const adapted = adaptPolicyFn(existing, success, score)
  s.data.routes[keyStr] = {
    ...existing,
    policy: adapted.policy,
    consecutiveSuccesses: adapted.consecutiveSuccesses,
    lastSafeDelayMs: adapted.lastSafeDelayMs,
    delayHistory: adapted.delayHistory,
    updatedAt: Date.now(),
  }
  s.dirty = true
}
