export interface Policy {
  minLaunchIntervalMs: number
  maxInflight: number
  maxStreams: number
  cooldownMs: number
  jitterMs: number
}

export function defaultPolicy(): Policy {
  return {
    minLaunchIntervalMs: 500,
    maxInflight: 10,
    maxStreams: 4,
    cooldownMs: 5000,
    jitterMs: 100,
  }
}

export interface LimitsObserved {
  remoteMaxConcurrentStreams: number | null
  lastKnownGoodInflight: number
  lastKnownGoodStreams: number
}

export interface ProtocolInfo {
  alpnAdvertised: string[]
  alpnNegotiated: string
  lastSeenAt: number
}

export interface RouteAdjustment {
  protocol: ProtocolInfo
  policy: Policy
  health: {
    successRate: number
    ewmaLatencyMs: number
    ewmaTtftMs: number
    ewmaChunkGapMs: number
    ewmaPingMs: number
    recent429: number
    recent5xx: number
    recentConnReset: number
    recentReadTimeout: number
  }
  limitsObserved: LimitsObserved
  confidence: number
  updatedAt: number
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
    protocol: {
      alpnAdvertised: [],
      alpnNegotiated: "unknown",
      lastSeenAt: now,
    },
    policy: defaultPolicy(),
    health: {
      successRate: 1.0,
      ewmaLatencyMs: 0,
      ewmaTtftMs: 0,
      ewmaChunkGapMs: 0,
      ewmaPingMs: 0,
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

export function adaptPolicy(adjustment: RouteAdjustment, success: boolean, score: number): Policy {
  const policy = { ...adjustment.policy }

  if (success && score > 0.8) {
    policy.minLaunchIntervalMs = Math.max(50, Math.round(policy.minLaunchIntervalMs * 0.95))
    if (score > 0.9 && adjustment.health.recent429 === 0) {
      policy.maxInflight = Math.min(50, policy.maxInflight + 1)
    }
  }

  if (!success || score < 0.5) {
    policy.minLaunchIntervalMs = Math.round(policy.minLaunchIntervalMs * 1.5)
    policy.maxInflight = Math.max(1, Math.round(policy.maxInflight * 0.5))
    policy.maxStreams = Math.max(1, Math.round(policy.maxStreams * 0.5))
    policy.cooldownMs = Math.min(60000, policy.cooldownMs * 2)
  }

  if (adjustment.limitsObserved.remoteMaxConcurrentStreams !== null) {
    const ceiling = Math.round(adjustment.limitsObserved.remoteMaxConcurrentStreams * 0.7)
    policy.maxStreams = Math.min(policy.maxStreams, ceiling)
  }

  return policy
}

export function updateConfidence(adjustment: RouteAdjustment, delta: number, now: number): RouteAdjustment {
  return {
    ...adjustment,
    confidence: Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, adjustment.confidence + delta)),
    updatedAt: now,
  }
}
