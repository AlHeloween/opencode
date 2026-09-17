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
  | "client_abort"
  | "unknown"

export interface NormalizedError {
  category: ErrorCategory
  retryable: boolean
  message: string
  statusCode?: number
}

/**
 * What a transport throws when the request never produced a response.
 *
 * It must be a real `Error`: the value travels out of the gateway into the
 * provider SDK and then into `MessageV2.fromError` / `SessionRetry.retryable`,
 * and every one of those consumers reads `message`, `code` or `instanceof
 * Error`. Throwing a plain object literal (as h1/h2 did until 2026-09-17) made
 * all of them fall through to `UnknownError`, so a connection reset was never
 * retried — the turn just died.
 *
 * The structured envelope the transports used to throw is preserved as fields,
 * and `code` is lifted off the underlying error so the existing ECONNRESET
 * branch in `MessageV2.fromError` still fires.
 */
export class TransportError extends Error {
  readonly status: number
  readonly headers: Headers | Record<string, string>
  readonly body: ReadableStream<Uint8Array> | string | null
  readonly metrics: unknown
  readonly error: NormalizedError
  readonly requestId?: string
  readonly code?: string

  constructor(input: {
    status: number
    headers: Headers | Record<string, string>
    body: ReadableStream<Uint8Array> | string | null
    metrics: unknown
    error: NormalizedError
    requestId?: string
    cause?: unknown
  }) {
    super(input.error.message, { cause: input.cause })
    this.name = "GatewayTransportError"
    this.status = input.status
    this.headers = input.headers
    this.body = input.body
    this.metrics = input.metrics
    this.error = input.error
    this.requestId = input.requestId
    const code = (input.cause as { code?: unknown })?.code
    if (typeof code === "string") this.code = code
  }
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
  // Bun words a mid-stream socket close as "The socket connection was closed
  // unexpectedly" and carries ECONNRESET only in `code` — see errorText().
  /socket.*clos/i,
  /premature.*close/i,
  /ERR_STREAM_PREMATURE_CLOSE/i,
]

const TLS_ERROR_PATTERNS = [/TLS/i, /SSL/i, /CERT_/i, /certificate/i, /handshake/i]

const GOAWAY_PATTERNS = [/GOAWAY/i, /http2.*goaway/i]

const REFUSED_STREAM_PATTERNS = [/REFUSED_STREAM/i, /stream.*refused/i, /RST_STREAM/i]

// The classification below matches on text, but the decisive token is often
// not in the message: Bun reports a mid-stream socket close as "The socket
// connection was closed unexpectedly" and puts ECONNRESET in `code`, and
// fetch buries the real failure one level down in `cause`. Match against all
// three so a reset is not classified as `unknown` (i.e. non-retryable).
function errorText(error: unknown): string {
  const parts: string[] = []
  for (let cur: unknown = error, depth = 0; cur && depth < 4; depth += 1) {
    const message = (cur as { message?: unknown }).message
    if (typeof message === "string") parts.push(message)
    const code = (cur as { code?: unknown }).code
    if (typeof code === "string") parts.push(code)
    const name = (cur as { name?: unknown }).name
    if (typeof name === "string") parts.push(name)
    cur = (cur as { cause?: unknown }).cause
  }
  if (parts.length === 0) return String(error)
  return parts.join(" ")
}

export function normalizeError(error: unknown): NormalizedError {
  const human = (error as { message?: unknown })?.message
  const message = typeof human === "string" ? human : String(error)
  // Only the retryable categories widen to the enriched text: that can turn
  // `unknown` (non-retryable) into a retry, never the other way round. The
  // non-retryable branches below keep matching the message alone, so nothing
  // that used to be retried stops being retried.
  const text = errorText(error)
  const statusCode = (error as any)?.statusCode ?? (error as any)?.status

  // An abort is ours, and tearing down a live stream can surface as a socket
  // close — classify it first so the widened patterns cannot turn the user's
  // stop into a retry.
  const aborted =
    (error instanceof DOMException && error.name === "AbortError") ||
    /^request aborted$/i.test(message) ||
    /abort(ed)? signal|signal is aborted|operation was aborted/i.test(message)

  if (!aborted && (statusCode === 429 || RATE_LIMIT_PATTERNS.some((p) => p.test(text)))) {
    return { category: "rate_or_rejection", retryable: true, message }
  }

  if (!aborted && CONN_RESET_PATTERNS.some((p) => p.test(text))) {
    return { category: "conn_reset", retryable: true, message }
  }

  if (TLS_ERROR_PATTERNS.some((p) => p.test(message))) {
    return { category: "tls_error", retryable: false, message }
  }

  if (!aborted && GOAWAY_PATTERNS.some((p) => p.test(text))) {
    return { category: "goaway", retryable: true, message }
  }

  if (!aborted && REFUSED_STREAM_PATTERNS.some((p) => p.test(text))) {
    return { category: "refused_stream", retryable: true, message }
  }

  if (!aborted && (/read.*timed?\s*out/i.test(text) || /ETIMEDOUT/i.test(text))) {
    return { category: "read_timeout", retryable: true, message }
  }

  if (!aborted && /write.*timed?\s*out/i.test(text)) {
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

  // Client-initiated abort: we cancelled our own request (user stop, session
  // interrupt, job_kill). NOT a provider fault — must not poison health
  // stats, must not trigger h1 fallback (user directive 2026-09-09).
  if (/^request aborted$/i.test(message) || /abort(ed)? signal|signal is aborted|operation was aborted/i.test(message)) {
    return { category: "client_abort", retryable: false, message }
  }

  if (/context.*overflow|context_length_exceeded|token.*limit/i.test(message)) {
    return { category: "context_overflow", retryable: false, message }
  }

  return { category: "unknown", retryable: false, message, statusCode }
}

export function shouldFallbackToH1(error: NormalizedError): boolean {
  if (error.category === "client_abort") return false
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
