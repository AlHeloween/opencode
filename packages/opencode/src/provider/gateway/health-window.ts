const ALPHA = 0.15
const WINDOW_SIZE = 100
const DELAY_BUFFER_SIZE = 100
const ERROR_DECAY_INTERVAL_MS = 600000
const ERROR_DECAY_FACTOR = 0.5

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

class CircularBuffer {
  private buffer: number[]
  private head: number
  private count: number
  private readonly capacity: number

  constructor(capacity: number = WINDOW_SIZE) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
    this.head = 0
    this.count = 0
  }

  push(value: number): void {
    this.buffer[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  toArray(): number[] {
    const result = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head - this.count + 1 + i + this.capacity) % this.capacity]
    }
    return result
  }

  get length(): number {
    return this.count
  }
}

export class DelayBuffer {
  private buffer: number[]
  private head: number
  private count: number
  private readonly capacity: number

  constructor(capacity: number = DELAY_BUFFER_SIZE) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
    this.head = 0
    this.count = 0
  }

  push(value: number): void {
    this.buffer[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  median(): number {
    if (this.count === 0) return 0
    const sorted = this.toArray().sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
      return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    }
    return sorted[mid]
  }

  toArray(): number[] {
    const result = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head - this.count + 1 + i + this.capacity) % this.capacity]
    }
    return result
  }

  get length(): number {
    return this.count
  }

  clear(): void {
    this.head = 0
    this.count = 0
    this.buffer.fill(0)
  }
}

export interface HealthWindow {
  latencySamples: CircularBuffer
  ttftSamples: CircularBuffer
  chunkGapSamples: CircularBuffer
  pingSamples: CircularBuffer
  errorCounts: {
    "429": number
    "5xx": number
    connReset: number
    readTimeout: number
  }
  lastErrorDecayAt: number
  totalSamples: number
  successSamples: number
  ewmaLatencyMs: number
  ewmaTtftMs: number
  ewmaChunkGapMs: number
  ewmaPingMs: number
}

export function make(): HealthWindow {
  return {
    latencySamples: new CircularBuffer(),
    ttftSamples: new CircularBuffer(),
    chunkGapSamples: new CircularBuffer(),
    pingSamples: new CircularBuffer(),
    errorCounts: { "429": 0, "5xx": 0, connReset: 0, readTimeout: 0 },
    lastErrorDecayAt: Date.now(),
    totalSamples: 0,
    successSamples: 0,
    ewmaLatencyMs: 0,
    ewmaTtftMs: 0,
    ewmaChunkGapMs: 0,
    ewmaPingMs: 0,
  }
}

function pushSample(samples: CircularBuffer, value: number): CircularBuffer {
  samples.push(value)
  return samples
}

function ewma(prev: number, current: number, alpha: number = ALPHA): number {
  return alpha * current + (1 - alpha) * prev
}

export function recordLatency(window: HealthWindow, ms: number): HealthWindow {
  const isFirst = window.latencySamples.length === 0
  window.latencySamples.push(ms)
  return {
    ...window,
    ewmaLatencyMs: isFirst ? ms : ewma(window.ewmaLatencyMs, ms),
  }
}

export function recordTtft(window: HealthWindow, ms: number): HealthWindow {
  window.ttftSamples.push(ms)
  return {
    ...window,
    ewmaTtftMs: window.totalSamples === 0 ? ms : ewma(window.ewmaTtftMs, ms),
  }
}

export function recordChunkGap(window: HealthWindow, ms: number): HealthWindow {
  window.chunkGapSamples.push(ms)
  return {
    ...window,
    ewmaChunkGapMs: window.totalSamples === 0 ? ms : ewma(window.ewmaChunkGapMs, ms),
  }
}

export function recordPing(window: HealthWindow, ms: number): HealthWindow {
  window.pingSamples.push(ms)
  return {
    ...window,
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

export function recordError(window: HealthWindow, category: string, now?: number): HealthWindow {
  const currentTime = now || Date.now()
  let errorCounts = { ...window.errorCounts }

  if (currentTime - window.lastErrorDecayAt > ERROR_DECAY_INTERVAL_MS) {
    errorCounts = {
      "429": Math.round(errorCounts["429"] * ERROR_DECAY_FACTOR),
      "5xx": Math.round(errorCounts["5xx"] * ERROR_DECAY_FACTOR),
      connReset: Math.round(errorCounts.connReset * ERROR_DECAY_FACTOR),
      readTimeout: Math.round(errorCounts.readTimeout * ERROR_DECAY_FACTOR),
    }
    errorCounts = { ...errorCounts, ...window.errorCounts }
    window = { ...window, errorCounts, lastErrorDecayAt: currentTime }
  }

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
  const errorSampleCount = Math.max(1, health.recent429 + health.recent5xx)

  return (
    1.0 -
    0.3 * errorRate -
    0.2 * normalize(errorSampleCount, 10) -
    0.2 * normalize(health.ewmaTtftMs, 5000) -
    0.15 * normalize(health.ewmaChunkGapMs, 500) -
    0.15 * normalize(health.ewmaPingMs, 200)
  )
}
