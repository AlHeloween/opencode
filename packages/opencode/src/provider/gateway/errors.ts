export type ErrorCategory =
  | "rate_or_rejection"
  | "conn_reset"
  | "tls_error"
  | "read_timeout"
  | "write_timeout"
  | "goaway"
  | "refused_stream"
  | "server_5xx"
  | "client_pool_pressure"
  | "context_overflow"
  | "auth_error"
  | "abort"
  | "unknown"

export interface NormalizedError {
  category: ErrorCategory
  retryable: boolean
  message: string
  statusCode?: number
}

const RATE_LIMIT_PATTERNS = [
  /rate[_\s]?limit/i,
  /too[_\s]?many[_\s]?requests/i,
  /over[_\s]?loaded/i,
  /exhausted/i,
  /unavailable/i,
  /usage[_\s]?limit/i,
  /free[_\s]?usage[_\s]?limit/i,
  /capacity/i,
  /quota/i,
  /throttl/i,
  /频率过高/i,
  /请求过于频繁/i,
  /限流/i,
]

const CONN_RESET_PATTERNS = [
  /ECONNRESET/i,
  /connection.*reset/i,
  /ECONNREFUSED/i,
  /connection.*refused/i,
  /socket.*hang/i,
  /broken.*pipe/i,
  /EPIPE/i,
]

const TLS_ERROR_PATTERNS = [/TLS/i, /SSL/i, /CERT_/i, /certificate/i, /handshake/i]

const GOAWAY_PATTERNS = [/GOAWAY/i, /http2.*goaway/i]

const REFUSED_STREAM_PATTERNS = [/REFUSED_STREAM/i, /stream.*refused/i, /RST_STREAM/i]

export function normalizeError(error: unknown): NormalizedError {
  const message = error instanceof Error ? error.message : String(error)
  const statusCode = (error as any)?.statusCode ?? (error as any)?.status

  if (statusCode === 429 || RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
    return { category: "rate_or_rejection", retryable: true, message }
  }

  if (CONN_RESET_PATTERNS.some((p) => p.test(message))) {
    return { category: "conn_reset", retryable: true, message }
  }

  if (TLS_ERROR_PATTERNS.some((p) => p.test(message))) {
    return { category: "tls_error", retryable: false, message }
  }

  if (GOAWAY_PATTERNS.some((p) => p.test(message))) {
    return { category: "goaway", retryable: true, message }
  }

  if (REFUSED_STREAM_PATTERNS.some((p) => p.test(message))) {
    return { category: "refused_stream", retryable: true, message }
  }

  if (/read.*timed?\s*out/i.test(message) || /ETIMEDOUT/i.test(message)) {
    return { category: "read_timeout", retryable: true, message }
  }

  if (/write.*timed?\s*out/i.test(message)) {
    return { category: "write_timeout", retryable: true, message }
  }

  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return { category: "server_5xx", retryable: true, message, statusCode }
  }

  if (statusCode === 401 || statusCode === 403) {
    return { category: "auth_error", retryable: false, message, statusCode }
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return { category: "abort", retryable: false, message }
  }

  if (/context.*overflow|context_length_exceeded|token.*limit/i.test(message)) {
    return { category: "context_overflow", retryable: false, message }
  }

  return { category: "unknown", retryable: false, message, statusCode }
}

export function shouldFallbackToH1(error: NormalizedError): boolean {
  if (error.category === "goaway" || error.category === "refused_stream") return true
  if (error.category === "conn_reset") return true
  if (error.category === "unknown") return true
  if (error.category === "client_pool_pressure") return true

  if (error.category === "read_timeout" || error.category === "write_timeout") {
    return /session.*timeout|idle.*timeout|h2.*timeout|stream.*timeout/i.test(error.message)
  }

  if (error.category === "rate_or_rejection") {
    return /stream.*reject|refused.*stream|too.*many.*streams/i.test(error.message)
  }

  return false
}
