import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import type { AdjustmentStoreData, RouteAdjustment } from "./adjustment-store"
import { initialStore, getOrCreateRoute } from "./adjustment-store"
import * as HealthWindow from "./health-window"
import type { HealthMetrics } from "./health-window"
import { Log } from "@/util/log"
import { toRouteKeyString, parseRouteKeyString, type RouteKey } from "./route-key"

const STORE_FILE = "gateway-adjustments.json"
const PERSIST_INTERVAL_MS = 30000

const log = Log.create({ prefix: "gateway/store" })

interface StoreState {
  data: AdjustmentStoreData
  dirty: boolean
  lastPersisted: number
  healthWindows: Map<string, HealthWindow.HealthWindow>
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
      }
    }
    return {
      data,
      dirty: false,
      lastPersisted: Date.now(),
      healthWindows: new Map(),
    }
  } catch {
    return {
      data: initialStore(),
      dirty: false,
      lastPersisted: Date.now(),
      healthWindows: new Map(),
    }
  }
}

async function persist(): Promise<void> {
  if (!state || !state.dirty) return

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

  await fs.writeFile(tempPath, JSON.stringify(dataToWrite, null, 2))
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
  if (!route) {
    const now = Date.now()
    const created = getOrCreateRoute(s.data, keyStr, now)
    s.dirty = true
    return created
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
}

export function recordError(key: RouteKey, category: string, latencyMs?: number): void {
  const s = ensureLoaded()
  const keyStr = toRouteKeyString(key)
  let hw = s.healthWindows.get(keyStr)
  if (!hw) {
    hw = HealthWindow.make()
    s.healthWindows.set(keyStr, hw)
  }
  hw = HealthWindow.recordError(hw, category)
  if (latencyMs !== undefined && latencyMs > 0) hw = HealthWindow.recordLatency(hw, latencyMs)
  s.healthWindows.set(keyStr, hw)
  s.dirty = true
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
