export interface Policy {
  minLaunchIntervalMs: number
  streamMinLaunchIntervalMs: number
  maxInflight: number
  maxStreams: number
  cooldownMs: number
  jitterMs: number
}

export function defaultPolicy(): Policy {
  return {
    minLaunchIntervalMs: 500,
    streamMinLaunchIntervalMs: 500,
    maxInflight: 10,
    maxStreams: 8,
    cooldownMs: 15000,
    jitterMs: 100,
  }
}

const MAX_LAUNCH_INTERVAL_MS = 600000

export function enforcePolicyFloors(policy: Policy): Policy {
  return {
    minLaunchIntervalMs: Math.min(MAX_LAUNCH_INTERVAL_MS, Math.max(50, policy.minLaunchIntervalMs)),
    streamMinLaunchIntervalMs: Math.min(MAX_LAUNCH_INTERVAL_MS, Math.max(50, policy.streamMinLaunchIntervalMs)),
    maxInflight: Math.min(100, Math.max(1, policy.maxInflight)),
    maxStreams: Math.min(50, Math.max(1, policy.maxStreams)),
    cooldownMs: Math.min(60000, Math.max(1000, policy.cooldownMs)),
    jitterMs: Math.max(0, policy.jitterMs),
  }
}

export interface LimitsObserved {
  remoteMaxConcurrentStreams: number | null
  lastKnownGoodInflight: number
  lastKnownGoodStreams: number
}

export interface StreamingPreference {
  enabled: boolean
  autoTuned: boolean
  lastTestedAt: number
  consecutiveSuccesses: number
  consecutiveFailures: number
}

export function defaultStreamingPreference(): StreamingPreference {
  return {
    enabled: true,
    autoTuned: false,
    lastTestedAt: 0,
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
  }
}

const STREAMING_DISABLE_THRESHOLD = 3
const STREAMING_ENABLE_THRESHOLD = 5

export function updateStreamingPreference(
  pref: StreamingPreference,
  success: boolean,
  now: number,
): StreamingPreference {
  const updated = {
    ...pref,
    lastTestedAt: now,
    autoTuned: true,
  }

  if (success) {
    updated.consecutiveSuccesses = pref.consecutiveSuccesses + 1
    updated.consecutiveFailures = 0

    // Re-enable streaming after enough successes
    if (!pref.enabled && updated.consecutiveSuccesses >= STREAMING_ENABLE_THRESHOLD) {
      updated.enabled = true
      updated.consecutiveSuccesses = 0
    }
  } else {
    updated.consecutiveFailures = pref.consecutiveFailures + 1
    updated.consecutiveSuccesses = 0

    // Disable streaming after enough failures
    if (pref.enabled && updated.consecutiveFailures >= STREAMING_DISABLE_THRESHOLD) {
      updated.enabled = false
      updated.consecutiveFailures = 0
    }
  }

  return updated
}

export interface RouteAdjustment {
  policy: Policy
  streamingPreference: StreamingPreference
  health: {
    successRate: number
    p50LatencyMs: number
    p50TtftMs: number
    p50ChunkGapMs: number
    p50PingMs: number
    recent429: number
    recent5xx: number
    recentConnReset: number
    recentReadTimeout: number
  }
  limitsObserved: LimitsObserved
  confidence: number
  updatedAt: number
  consecutiveSuccesses: number
  lastSafeDelayMs: number
  delayHistory: number[]
}

export interface AdjustmentStoreData {
  version: number
  routes: Record<string, RouteAdjustment>
}

export function initialStore(): AdjustmentStoreData {
  return {
    version: 1,
    routes: {},
  }
}

export function getOrCreateRoute(store: AdjustmentStoreData, key: string, now: number): RouteAdjustment {
  const existing = store.routes[key]
  if (existing) return existing

  const adjustment: RouteAdjustment = {
    policy: defaultPolicy(),
    streamingPreference: defaultStreamingPreference(),
    health: {
      successRate: 1.0,
      p50LatencyMs: 0,
      p50TtftMs: 0,
      p50ChunkGapMs: 0,
      p50PingMs: 0,
      recent429: 0,
      recent5xx: 0,
      recentConnReset: 0,
      recentReadTimeout: 0,
    },
    limitsObserved: {
      remoteMaxConcurrentStreams: null,
      lastKnownGoodInflight: defaultPolicy().maxInflight,
      lastKnownGoodStreams: defaultPolicy().maxStreams,
    },
    confidence: 0.3,
    updatedAt: now,
    consecutiveSuccesses: 0,
    lastSafeDelayMs: 0,
    delayHistory: [],
  }

  store.routes[key] = adjustment
  return adjustment
}

const CONFIDENCE_DECAY_PER_MINUTE = 0.01
const MIN_CONFIDENCE = 0.1
const MAX_CONFIDENCE = 0.95

export function decayConfidence(adjustment: RouteAdjustment, now: number): RouteAdjustment {
  const elapsedMinutes = (now - adjustment.updatedAt) / 60000
  const decay = Math.min(elapsedMinutes * CONFIDENCE_DECAY_PER_MINUTE, adjustment.confidence - MIN_CONFIDENCE)
  return {
    ...adjustment,
    confidence: Math.max(MIN_CONFIDENCE, adjustment.confidence - decay),
  }
}

export function updateHealth(
  adjustment: RouteAdjustment,
  health: RouteAdjustment["health"],
  now: number,
): RouteAdjustment {
  return {
    ...adjustment,
    health,
    updatedAt: now,
  }
}

const DELAY_HISTORY_SIZE = 100
const DELAY_DECAY_FACTOR = 0.15
const DELAY_GROWTH_FACTOR = 1.5
const DEFAULT_MIN_LAUNCH_INTERVAL = 500

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  }
  return sorted[mid]
}

export function adaptPolicy(
  adjustment: RouteAdjustment,
  success: boolean,
  score: number,
): { policy: Policy; consecutiveSuccesses: number; lastSafeDelayMs: number; delayHistory: number[] } {
  const policy = { ...adjustment.policy }
  let consecutiveSuccesses = adjustment.consecutiveSuccesses
  let lastSafeDelayMs = adjustment.lastSafeDelayMs
  let delayHistory = [...adjustment.delayHistory]

  if (success && score > 0.8) {
    consecutiveSuccesses++
    delayHistory.push(policy.minLaunchIntervalMs)
    if (delayHistory.length > DELAY_HISTORY_SIZE) {
      delayHistory = delayHistory.slice(-DELAY_HISTORY_SIZE)
    }

    if (delayHistory.length >= 20) {
      const median = computeMedian(delayHistory)
      if (policy.minLaunchIntervalMs > median * 1.5) {
        const target = Math.max(DEFAULT_MIN_LAUNCH_INTERVAL, Math.round(median * 1.2))
        policy.minLaunchIntervalMs = Math.max(
          DEFAULT_MIN_LAUNCH_INTERVAL,
          Math.round(policy.minLaunchIntervalMs * (1 - DELAY_DECAY_FACTOR) + target * DELAY_DECAY_FACTOR),
        )
        policy.streamMinLaunchIntervalMs = policy.minLaunchIntervalMs
      }
    }

    if (consecutiveSuccesses >= 50) {
      policy.minLaunchIntervalMs = Math.max(DEFAULT_MIN_LAUNCH_INTERVAL, Math.round(policy.minLaunchIntervalMs * 0.95))
      policy.streamMinLaunchIntervalMs = policy.minLaunchIntervalMs
      consecutiveSuccesses = 0
    }

    if (score > 0.9 && adjustment.health.recent429 === 0) {
      policy.maxInflight = Math.min(50, policy.maxInflight + 1)
    }

    lastSafeDelayMs = policy.minLaunchIntervalMs
  }

  if (!success || score < 0.5) {
    const oldInterval = policy.minLaunchIntervalMs
    policy.minLaunchIntervalMs = Math.min(
      MAX_LAUNCH_INTERVAL_MS,
      Math.round(policy.minLaunchIntervalMs * DELAY_GROWTH_FACTOR),
    )
    policy.streamMinLaunchIntervalMs = Math.min(
      MAX_LAUNCH_INTERVAL_MS,
      Math.round(policy.streamMinLaunchIntervalMs * DELAY_GROWTH_FACTOR),
    )
    policy.maxInflight = Math.max(1, Math.round(policy.maxInflight * 0.5))
    policy.maxStreams = Math.max(1, Math.round(policy.maxStreams * 0.5))
    policy.cooldownMs = Math.min(60000, policy.cooldownMs * 2)

    if (lastSafeDelayMs > 0 && policy.minLaunchIntervalMs > lastSafeDelayMs * 4) {
      policy.minLaunchIntervalMs = Math.min(policy.minLaunchIntervalMs, lastSafeDelayMs * 4)
      policy.streamMinLaunchIntervalMs = policy.minLaunchIntervalMs
    }

    delayHistory = []
    consecutiveSuccesses = 0
  }

  if (adjustment.limitsObserved.remoteMaxConcurrentStreams !== null) {
    const ceiling = Math.round(adjustment.limitsObserved.remoteMaxConcurrentStreams * 0.7)
    policy.maxStreams = Math.min(policy.maxStreams, ceiling)
  }

  return { policy, consecutiveSuccesses, lastSafeDelayMs, delayHistory }
}

export function updateConfidence(adjustment: RouteAdjustment, delta: number, now: number): RouteAdjustment {
  return {
    ...adjustment,
    confidence: Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, adjustment.confidence + delta)),
    updatedAt: now,
  }
}
