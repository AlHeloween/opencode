import type { Policy } from "./adjustment-store"

interface Slot {
  acquired: boolean
  acquiredAt: number
}

export interface LimiterState {
  lastLaunchAt: number
  inflight: number
  slots: Map<string, Slot>
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
    lastLaunchAt: 0,
    inflight: 0,
    slots: new Map(),
  }
}

export function tryAcquireLaunch(state: LimiterState, policy: Policy): AcquireResult {
  const now = Date.now()
  const elapsed = now - state.lastLaunchAt
  const jitter = Math.random() * policy.jitterMs
  const minInterval = policy.minLaunchIntervalMs + jitter

  if (elapsed >= minInterval) {
    const slotId = makeSlotId()
    state.lastLaunchAt = now
    state.slots.set(slotId, { acquired: true, acquiredAt: now })
    return { acquired: true, waitMs: 0, slotId }
  }

  return { acquired: false, waitMs: minInterval - elapsed, slotId: "" }
}

export function tryAcquireInflight(state: LimiterState, policy: Policy): AcquireResult {
  if (state.inflight < policy.maxInflight) {
    const slotId = makeSlotId()
    state.inflight++
    state.slots.set(slotId, { acquired: true, acquiredAt: Date.now() })
    return { acquired: true, waitMs: 0, slotId }
  }

  return { acquired: false, waitMs: 100, slotId: "" }
}

export function release(state: LimiterState, slotId: string): void {
  const slot = state.slots.get(slotId)
  if (slot) {
    state.inflight = Math.max(0, state.inflight - 1)
    state.slots.delete(slotId)
  }
}

export function getInflight(state: LimiterState): number {
  return state.inflight
}

export function getSlotDuration(state: LimiterState, slotId: string): number {
  const slot = state.slots.get(slotId)
  if (!slot) return 0
  return Date.now() - slot.acquiredAt
}

export async function acquireWithBackoff(
  state: LimiterState,
  policy: Policy,
  kind: "launch" | "inflight",
  maxWaitMs: number = 30000,
): Promise<AcquireResult> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const result = kind === "launch" ? tryAcquireLaunch(state, policy) : tryAcquireInflight(state, policy)
    if (result.acquired) {
      return result
    }

    const waitTime = Math.min(result.waitMs + Math.random() * 50, 2000)
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }

  return { acquired: false, waitMs: Date.now() - start, slotId: "" }
}
