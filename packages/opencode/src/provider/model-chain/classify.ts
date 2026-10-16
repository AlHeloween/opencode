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
}

/** Floor so a healthy-but-slow model is never cut by noise. */
export const FIRST_TOKEN_FLOOR_MS = 30_000
/** Multiple of the measured p50-TTFT that defines "hung". */
export const FIRST_TOKEN_P50_MULTIPLE = 3

const PRIVACY_GATE = /train.*request data|privacy settings|allow paid endpoints/i
const BALANCE = /insufficient.*balance|insufficient_quota|FreeUsageLimitError|402/i
const MODEL_NOT_FOUND = /model not found|model_not_found|did you mean/i
const UNKNOWN_FIELD = /unknown field|unknown parameter/i
const TIMEOUT = /timed out|timeout|headers timed out|econnreset|zlib|decompression|connection reset|response.*stream.*(error|closed)|fetch failed|network/i
const RATE = /too many requests|rate limit|rate increased|429/i
const OVERLOADED = /overloaded|service unavailable|server.*overloaded|temporarily unavailable/i

export function classifyChainError(input: ChainErrorInput): ChainErrorClass {
  const message = input.message ?? ""
  if (input.field !== undefined && input.field.length > 0) return "terminal"
  if (UNKNOWN_FIELD.test(message)) return "terminal"
  if (PRIVACY_GATE.test(message)) return "terminal"
  if (BALANCE.test(message)) return "terminal"
  if (MODEL_NOT_FOUND.test(message)) return "terminal"
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
