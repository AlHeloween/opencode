export type CircuitState = "closed" | "open" | "half-open"

export interface CircuitBreaker {
  state: CircuitState
  openedAt: number
  failCount: number
  probeCount: number
  lastProbeAt: number
}

export interface CircuitBreakerConfig {
  failThreshold: number
  cooldownMs: number
  probeLimit: number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failThreshold: 5,
  cooldownMs: 30000,
  probeLimit: 3,
}

export function make(): CircuitBreaker {
  return {
    state: "closed",
    openedAt: 0,
    failCount: 0,
    probeCount: 0,
    lastProbeAt: 0,
  }
}

export function shouldAllowRequest(cb: CircuitBreaker, config: CircuitBreakerConfig = DEFAULT_CONFIG): boolean {
  switch (cb.state) {
    case "closed":
      return true
    case "open":
      // Allow probe requests after cooldown
      if (Date.now() - cb.openedAt > config.cooldownMs) {
        return cb.probeCount < config.probeLimit
      }
      return false
    case "half-open":
      return cb.probeCount < config.probeLimit
  }
}

export function recordSuccess(cb: CircuitBreaker, config: CircuitBreakerConfig = DEFAULT_CONFIG): CircuitBreaker {
  if (cb.state === "open" || cb.state === "half-open") {
    const updated = { ...cb, probeCount: cb.probeCount + 1 }
    if (updated.probeCount >= config.probeLimit) {
      updated.state = "closed"
      updated.failCount = 0
      updated.probeCount = 0
    }
    return updated
  }
  return { ...cb, failCount: Math.max(0, cb.failCount - 1) }
}

export function recordFailure(cb: CircuitBreaker, config: CircuitBreakerConfig = DEFAULT_CONFIG): CircuitBreaker {
  if (cb.state === "closed") {
    const updated = { ...cb, failCount: cb.failCount + 1 }
    if (updated.failCount >= config.failThreshold) {
      updated.state = "open"
      updated.openedAt = Date.now()
      updated.probeCount = 0
    }
    return updated
  }
  if (cb.state === "half-open" || cb.state === "open") {
    return {
      ...cb,
      state: "open",
      openedAt: Date.now(),
      probeCount: 0,
      failCount: cb.failCount + 1,
    }
  }
  return cb
}

export function getMetrics(cb: CircuitBreaker): { state: CircuitState; failCount: number; openedAt: number } {
  return {
    state: cb.state,
    failCount: cb.failCount,
    openedAt: cb.openedAt,
  }
}
