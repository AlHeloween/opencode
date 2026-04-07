export interface MetricsSample {
  queuedAt: number
  socketAcquiredAt: number
  headersReceivedAt: number
  firstChunkAt: number
  lastChunkAt: number
  endedAt: number
  chunks: number
  status: number
  requestId?: string
}

export interface MetricsResult {
  queuedMs: number
  ttfbMs: number
  ttftMs: number
  totalMs: number
  chunks: number
  chunkGapMs: number
  avgChunkGapMs: number
  status: number
  requestId?: string
}

export function computeMetrics(sample: MetricsSample): MetricsResult {
  const queuedMs = sample.socketAcquiredAt - sample.queuedAt
  const ttfbMs = sample.headersReceivedAt - sample.socketAcquiredAt
  const ttftMs = sample.firstChunkAt - sample.headersReceivedAt
  const totalMs = sample.endedAt - sample.queuedAt
  const chunkGapMs = sample.chunks > 1 ? sample.lastChunkAt - sample.firstChunkAt : 0
  const avgChunkGapMs = sample.chunks > 1 ? chunkGapMs / (sample.chunks - 1) : 0

  return {
    queuedMs,
    ttfbMs,
    ttftMs,
    totalMs,
    chunks: sample.chunks,
    chunkGapMs,
    avgChunkGapMs,
    status: sample.status,
    requestId: sample.requestId,
  }
}

export function makeSample(status: number, requestId?: string): MetricsSample {
  const now = Date.now()
  return {
    queuedAt: now,
    socketAcquiredAt: 0,
    headersReceivedAt: 0,
    firstChunkAt: 0,
    lastChunkAt: 0,
    endedAt: 0,
    chunks: 0,
    status,
    requestId,
  }
}

export function markSocketAcquired(sample: MetricsSample): MetricsSample {
  return { ...sample, socketAcquiredAt: Date.now() }
}

export function markHeadersReceived(sample: MetricsSample): MetricsSample {
  return { ...sample, headersReceivedAt: Date.now() }
}

export function markFirstChunk(sample: MetricsSample): MetricsSample {
  const now = Date.now()
  return {
    ...sample,
    firstChunkAt: sample.firstChunkAt === 0 ? now : sample.firstChunkAt,
    lastChunkAt: now,
    chunks: sample.chunks + 1,
  }
}

export function markChunk(sample: MetricsSample): MetricsSample {
  return {
    ...sample,
    lastChunkAt: Date.now(),
    chunks: sample.chunks + 1,
  }
}

export function markEnded(sample: MetricsSample): MetricsSample {
  return { ...sample, endedAt: Date.now() }
}
