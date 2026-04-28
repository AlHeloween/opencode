import type { Policy } from "./adjustment-store"
import type { RouteKey } from "./route-key"

interface Slot {
  acquired: boolean
  acquiredAt: number
}

export interface RouteLimiterState {
  lastLaunchAt: number
  inflight: number
  slots: Map<string, Slot>
}

export interface LimiterState {
  routes: Map<string, RouteLimiterState>
}

export interface AcquireResult {
  acquired: boolean
  waitMs: number
  slotId: string
}

function makeSlotId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function makeState(): LimiterState {
  return {
    routes: new Map(),
  }
}

function getOrCreateRoute(state: LimiterState, routeKey: RouteKey): RouteLimiterState {
  const key = `${routeKey.provider}:${routeKey.model}:${routeKey.requestShapeClass}`
  if (!state.routes.has(key)) {
    state.routes.set(key, {
      lastLaunchAt: 0,
      inflight: 0,
      slots: new Map(),
    })
  }
  return state.routes.get(key)!
}

export function tryAcquireLaunch(
  state: LimiterState,
  routeKey: RouteKey,
  policy: Policy,
  streaming: boolean = false,
): AcquireResult {
  const route = getOrCreateRoute(state, routeKey)
  const now = Date.now()
  const elapsed = now - route.lastLaunchAt
  const jitter = Math.random() * policy.jitterMs
  const minInterval = (streaming ? policy.streamMinLaunchIntervalMs : policy.minLaunchIntervalMs) + jitter

  if (elapsed >= minInterval) {
    const slotId = makeSlotId()
    route.lastLaunchAt = now
    route.slots.set(slotId, { acquired: true, acquiredAt: now })
    return { acquired: true, waitMs: 0, slotId }
  }

  return { acquired: false, waitMs: minInterval - elapsed, slotId: "" }
}

export function tryAcquireInflight(state: LimiterState, routeKey: RouteKey, policy: Policy): AcquireResult {
  const route = getOrCreateRoute(state, routeKey)
  if (route.inflight < policy.maxInflight) {
    const slotId = makeSlotId()
    route.inflight++
    route.slots.set(slotId, { acquired: true, acquiredAt: Date.now() })
    return { acquired: true, waitMs: 0, slotId }
  }

  return { acquired: false, waitMs: 100, slotId: "" }
}

export function release(state: LimiterState, routeKey: RouteKey, slotId: string): void {
  const route = getOrCreateRoute(state, routeKey)
  const slot = route.slots.get(slotId)
  if (slot) {
    route.inflight = Math.max(0, route.inflight - 1)
    route.slots.delete(slotId)
  }
}

export function getInflight(state: LimiterState, routeKey: RouteKey): number {
  const route = getOrCreateRoute(state, routeKey)
  return route.inflight
}

export function getSlotDuration(state: LimiterState, routeKey: RouteKey, slotId: string): number {
  const route = getOrCreateRoute(state, routeKey)
  const slot = route.slots.get(slotId)
  if (!slot) return 0
  return Date.now() - slot.acquiredAt
}

export async function acquireWithBackoff(
  state: LimiterState,
  routeKey: RouteKey,
  policy: Policy,
  kind: "launch" | "inflight",
  maxWaitMs: number = 30000,
  streaming: boolean = false,
): Promise<AcquireResult> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const result =
      kind === "launch"
        ? tryAcquireLaunch(state, routeKey, policy, streaming)
        : tryAcquireInflight(state, routeKey, policy)
    if (result.acquired) {
      return result
    }

    const waitTime = Math.min(result.waitMs + Math.random() * 50, 2000)
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }

  return { acquired: false, waitMs: Date.now() - start, slotId: "" }
}
