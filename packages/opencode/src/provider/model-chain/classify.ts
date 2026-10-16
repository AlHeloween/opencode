/**
 * Terminal-vs-transient classification (t68).
 *
 * Reuses the existing parse layer (`provider/error.ts parseAPICallError`,
 * `session/retry.ts retryable`): this module does NOT re-decide overflow
 * or body-schema facts, it maps the already-parsed refusal onto the one
 * question failover asks — "can retrying this member ever heal?".
 *
 * Terminal = DOWN at once, zero retries on the member.
 * Transient = the existing bounded retry, then DOWN.
 */

export type ChainErrorClass = "terminal" | "transient"

export interface ChainErrorInput {
  statusCode?: number
  message: string
  code?: string
  /** Unknown-parameter field named by the provider (body-schema descent). */
  field?: string
  /**
   * Provider-ordered wait in ms, parsed off `retry-after` headers (never
   * guessed). A wait longer than this attempt's own liveness budget
   * (FIRST_TOKEN_FLOOR_MS, measured R4) means the member cannot serve THIS
   * attempt: DOWN now, the 10-minute probe re-arms it.
   */
  retryAfterMs?: number
}

/**
 * Floor for the hung-stream threshold, MEASURED 2026-10-16 (read-only,
 * `.opencode/data/opencode.db`, user→assistant latency over
 * `message.time_created`, window 1 s–60 min):
 * - `opencode/muse-spark-1.3-contributor-free`, n=33: p50 = 23 594 ms, p95 = 50 761 ms;
 * - `opencode-go/muse-spark-1.3-contributor`, n=5: p50 = 41 009 ms, max = 50 819 ms.
 * The metric is response latency, not wire TTFT (it covers the run up to the
 * first assistant message) — so the threshold must clear the slowest LIVE
 * answer (~51 s), not the median: FLOOR = 120 000 ms (~2.4× observed max).
 * A 30 s floor would cut live answers (today: Go OK in 37 s, free p50 23.6 s).
 * Re-measure with the same query when the model set changes; a floor below
 * the observed max is a defect, not tuning.
 */
export const FIRST_TOKEN_FLOOR_MS = 120_000
/** Multiple of the measured p50 that defines "hung" (see FLOOR comment for provenance). */
export const FIRST_TOKEN_P50_MULTIPLE = 3

const PRIVACY_GATE = /train.*request data|privacy settings|allow paid endpoints/i
const BALANCE = /insufficient.*balance|insufficient_quota|FreeUsageLimitError|402/i
const MODEL_NOT_FOUND = /model not found|model_not_found|did you mean/i
const UNKNOWN_FIELD = /unknown field|unknown parameter/i
const TIMEOUT = /timed out|timeout|headers timed out|econnreset|zlib|decompression|connection reset|response.*stream.*(error|closed)|fetch failed|network/i
const RATE = /too many requests|rate limit|rate increased|429/i
const OVERLOADED = /overloaded|service unavailable|server.*overloaded|temporarily unavailable/i

/**
 * Provider-ordered wait in ms off raw `retry-after` headers — the same
 * semantics `session/retry.ts delay()` honors (ms-key wins, then seconds,
 * then HTTP date). `undefined` when absent or unparseable: no header, no wait.
 */
export function parseRetryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined
  const msRaw = headers["retry-after-ms"]
  if (typeof msRaw === "string") {
    const parsedMs = Number.parseFloat(msRaw)
    if (!Number.isNaN(parsedMs)) return parsedMs
  }
  const raw = headers["retry-after"]
  if (typeof raw !== "string") return undefined
  const parsedSeconds = Number.parseFloat(raw)
  if (!Number.isNaN(parsedSeconds)) return Math.ceil(parsedSeconds * 1000)
  const parsedDate = Date.parse(raw) - Date.now()
  if (!Number.isNaN(parsedDate) && parsedDate > 0) return Math.ceil(parsedDate)
  return undefined
}
export function classifyChainError(input: ChainErrorInput): ChainErrorClass {
  const message = input.message ?? ""
  if (input.field !== undefined && input.field.length > 0) return "terminal"
  if (UNKNOWN_FIELD.test(message)) return "terminal"
  if (PRIVACY_GATE.test(message)) return "terminal"
  if (BALANCE.test(message)) return "terminal"
  if (MODEL_NOT_FOUND.test(message)) return "terminal"
  // A provider-ordered wait longer than the longest we ever wait for a first
  // token (FIRST_TOKEN_FLOOR_MS) means the member cannot serve this attempt.
  // Waiting it out is the t73 hang (429 + retry-after 49715s held the session
  // busy ~14h). Short waits stay transient on the existing bounded retry.
  if (input.retryAfterMs !== undefined && input.retryAfterMs > FIRST_TOKEN_FLOOR_MS) return "terminal"
  const status = input.statusCode
  if (status === 401 || status === 403) return "terminal"
  if (status === 402) return "terminal"
  if (status === 404) return "terminal"
  if (status === 429) return "transient"
  if (status !== undefined && status >= 500) return "transient"
  if (TIMEOUT.test(message)) return "transient"
  if (RATE.test(message)) return "transient"
  if (OVERLOADED.test(message)) return "transient"
  if (input.code === "FIRST_TOKEN_TIMEOUT") return "transient"
  if (input.code === "429" || input.code === "rate_or_rejection") return "transient"
  if (input.code === "5xx" || input.code === "server_5xx") return "transient"
  if (input.code === "conn_reset" || input.code === "read_timeout") return "transient"
  return "transient"
}

/**
 * Hung-stream threshold derived from the measured p50-TTFT
 * (`HealthWindow` p50TtftMs), never a guessed constant:
 * `max(FIRST_TOKEN_FLOOR_MS, FIRST_TOKEN_P50_MULTIPLE × p50)`.
 */
export function firstTokenTimeoutMs(p50TtftMs: number): number {
  if (!Number.isFinite(p50TtftMs) || p50TtftMs <= 0) return FIRST_TOKEN_FLOOR_MS
  return Math.max(FIRST_TOKEN_FLOOR_MS, Math.round(FIRST_TOKEN_P50_MULTIPLE * p50TtftMs))
}

