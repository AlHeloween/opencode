import type { Policy } from "./adjustment-store"

interface StreamSlot {
  acquired: boolean
  acquiredAt: number
  routeKey: string
}

export interface StreamBudgetState {
  activeStreams: number
  slots: Map<string, StreamSlot>
}

export interface StreamAcquireResult {
  acquired: boolean
  waitMs: number
  slotId: string
}

function makeSlotId(): string {
  return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function makeState(): StreamBudgetState {
  return {
    activeStreams: 0,
    slots: new Map(),
  }
}

export function tryAcquire(state: StreamBudgetState, policy: Policy, routeKey: string): StreamAcquireResult {
  if (state.activeStreams < policy.maxStreams) {
    const slotId = makeSlotId()
    state.activeStreams++
    state.slots.set(slotId, { acquired: true, acquiredAt: Date.now(), routeKey })
    return { acquired: true, waitMs: 0, slotId }
  }

  return { acquired: false, waitMs: 200, slotId: "" }
}

export function release(state: StreamBudgetState, slotId: string): void {
  const slot = state.slots.get(slotId)
  if (slot) {
    state.activeStreams = Math.max(0, state.activeStreams - 1)
    state.slots.delete(slotId)
  }
}

export function getActiveStreams(state: StreamBudgetState): number {
  return state.activeStreams
}

export function getStreamDuration(state: StreamBudgetState, slotId: string): number {
  const slot = state.slots.get(slotId)
  if (!slot) return 0
  return Date.now() - slot.acquiredAt
}

export function getStreamsByRoute(state: StreamBudgetState, routeKey: string): number {
  let count = 0
  for (const slot of state.slots.values()) {
    if (slot.routeKey === routeKey) count++
  }
  return count
}

export async function acquireWithBackoff(
  state: StreamBudgetState,
  policy: Policy,
  routeKey: string,
  maxWaitMs: number = 60000,
): Promise<StreamAcquireResult> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const result = tryAcquire(state, policy, routeKey)
    if (result.acquired) {
      return result
    }

    const waitTime = Math.min(result.waitMs + Math.random() * 100, 3000)
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }

  return { acquired: false, waitMs: Date.now() - start, slotId: "" }
}
