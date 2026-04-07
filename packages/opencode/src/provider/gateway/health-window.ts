const ALPHA = 0.15
const WINDOW_SIZE = 100

export interface HealthMetrics {
  successRate: number
  errorRate: number
  ewmaLatencyMs: number
  ewmaTtftMs: number
  ewmaChunkGapMs: number
  ewmaPingMs: number
  recent429: number
  recent5xx: number
  recentConnReset: number
  recentReadTimeout: number
  sampleCount: number
}

export interface HealthWindow {
  latencySamples: number[]
  ttftSamples: number[]
  chunkGapSamples: number[]
  pingSamples: number[]
  errorCounts: {
    "429": number
    "5xx": number
    connReset: number
    readTimeout: number
  }
  totalSamples: number
  successSamples: number
  ewmaLatencyMs: number
  ewmaTtftMs: number
  ewmaChunkGapMs: number
  ewmaPingMs: number
}

export function make(): HealthWindow {
  return {
    latencySamples: [],
    ttftSamples: [],
    chunkGapSamples: [],
    pingSamples: [],
    errorCounts: { "429": 0, "5xx": 0, connReset: 0, readTimeout: 0 },
    totalSamples: 0,
    successSamples: 0,
    ewmaLatencyMs: 0,
    ewmaTtftMs: 0,
    ewmaChunkGapMs: 0,
    ewmaPingMs: 0,
  }
}

function pushSample(samples: number[], value: number, maxSamples: number = WINDOW_SIZE): number[] {
  const updated = [...samples, value]
  if (updated.length > maxSamples) {
    return updated.slice(updated.length - maxSamples)
  }
  return updated
}

function ewma(prev: number, current: number, alpha: number = ALPHA): number {
  return alpha * current + (1 - alpha) * prev
}

export function recordLatency(window: HealthWindow, ms: number): HealthWindow {
  const isFirst = window.latencySamples.length === 0
  return {
    ...window,
    latencySamples: pushSample(window.latencySamples, ms),
    ewmaLatencyMs: isFirst ? ms : ewma(window.ewmaLatencyMs, ms),
  }
}

export function recordTtft(window: HealthWindow, ms: number): HealthWindow {
  return {
    ...window,
    ttftSamples: pushSample(window.ttftSamples, ms),
    ewmaTtftMs: window.totalSamples === 0 ? ms : ewma(window.ewmaTtftMs, ms),
  }
}

export function recordChunkGap(window: HealthWindow, ms: number): HealthWindow {
  return {
    ...window,
    chunkGapSamples: pushSample(window.chunkGapSamples, ms),
    ewmaChunkGapMs: window.totalSamples === 0 ? ms : ewma(window.ewmaChunkGapMs, ms),
  }
}

export function recordPing(window: HealthWindow, ms: number): HealthWindow {
  return {
    ...window,
    pingSamples: pushSample(window.pingSamples, ms),
    ewmaPingMs: window.totalSamples === 0 ? ms : ewma(window.ewmaPingMs, ms),
  }
}

export function recordSuccess(window: HealthWindow): HealthWindow {
  return {
    ...window,
    totalSamples: window.totalSamples + 1,
    successSamples: window.successSamples + 1,
  }
}

export function recordError(window: HealthWindow, category: string): HealthWindow {
  const errorCounts = { ...window.errorCounts }
  if (category === "429" || category === "rate_or_rejection") errorCounts["429"]++
  if (category === "5xx" || category === "server_5xx") errorCounts["5xx"]++
  if (category === "conn_reset") errorCounts.connReset++
  if (category === "read_timeout") errorCounts.readTimeout++

  return {
    ...window,
    errorCounts,
    totalSamples: window.totalSamples + 1,
  }
}

export function getMetrics(window: HealthWindow): HealthMetrics {
  const total = window.totalSamples || 1
  return {
    successRate: window.successSamples / total,
    errorRate: 1 - window.successSamples / total,
    ewmaLatencyMs: window.ewmaLatencyMs,
    ewmaTtftMs: window.ewmaTtftMs,
    ewmaChunkGapMs: window.ewmaChunkGapMs,
    ewmaPingMs: window.ewmaPingMs,
    recent429: window.errorCounts["429"],
    recent5xx: window.errorCounts["5xx"],
    recentConnReset: window.errorCounts.connReset,
    recentReadTimeout: window.errorCounts.readTimeout,
    sampleCount: window.totalSamples,
  }
}

export function healthScore(health: {
  successRate: number
  ewmaTtftMs: number
  ewmaChunkGapMs: number
  ewmaPingMs: number
  recent429: number
  recent5xx: number
}): number {
  const normalize = (value: number, max: number) => Math.min(1, value / max)
  const errorRate = 1 - health.successRate
  const sampleCount = 1

  return (
    1.0 -
    0.3 * errorRate -
    0.2 * normalize(health.recent429 + health.recent5xx, sampleCount) -
    0.2 * normalize(health.ewmaTtftMs, 5000) -
    0.15 * normalize(health.ewmaChunkGapMs, 500) -
    0.15 * normalize(health.ewmaPingMs, 200)
  )
}
