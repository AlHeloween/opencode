/**
 * Chain failover executor (t68).
 *
 * Walks the explicit chain in order. Terminal refusals mark the member
 * DOWN at once (zero retries on it); transient ones get a bounded retry
 * on the SAME member, then DOWN. The session continues on the next
 * healthy member with a visible note (which member, why) — never a
 * silent swap. An exhausted chain errors visibly and never invents
 * a model outside the user chain.
 */
import { markDown, memberKey } from "./chain"
import type { ChainHealth, ChainMember } from "./chain"
import { FIRST_TOKEN_FLOOR_MS, classifyChainError } from "./classify"

export interface ChainCallError {
  statusCode?: number
  message: string
  code?: string
  field?: string
}

export class ChainExhaustedError extends Error {
  readonly tried: string[]
  constructor(tried: string[], detail: string) {
    super(`model chain exhausted (tried ${tried.join(", ") || "none"}): ${detail}`)
    this.name = "ChainExhaustedError"
    this.tried = tried
  }
}

export interface FailoverResult {
  member: ChainMember
  text: string
  note: string
}

function normalizeCallError(error: unknown): ChainCallError {
  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>
    const message = typeof value.message === "string" ? value.message : String(error)
    const statusCode = typeof value.statusCode === "number" ? value.statusCode : undefined
    const code = typeof value.code === "string" ? value.code : undefined
    const field = typeof value.field === "string" ? value.field : undefined
    return { statusCode, message, code, field }
  }
  return { message: String(error) }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject({ message: `no first token within ${ms}ms`, code: "FIRST_TOKEN_TIMEOUT" }), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function shortReason(error: ChainCallError): string {
  const firstLine = error.message.split("\n")[0] ?? error.message
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine
}

export async function runWithFailover(options: {
  chain: ChainMember[]
  health: Map<string, ChainHealth>
  now: () => number
  /** First-token budget per attempt. Production passes firstTokenTimeoutMs(p50). */
  timeoutMs?: number
  /** Bounded transient retries on the SAME member (default 2 total attempts). */
  maxTransientAttempts?: number
  call: (member: ChainMember, attempt: number) => Promise<string>
  onNote?: (note: string) => void
}): Promise<FailoverResult> {
  const timeoutMs = options.timeoutMs ?? FIRST_TOKEN_FLOOR_MS
  const maxTransientAttempts = options.maxTransientAttempts ?? 2
  const tried: string[] = []
  const hops: string[] = []
  for (const member of options.chain) {
    const key = memberKey(member)
    if (options.health.get(key)?.status === "DOWN") {
      hops.push(`${key} skipped (DOWN)`)
      continue
    }
    let attempt = 0
    while (attempt < maxTransientAttempts) {
      attempt += 1
      try {
        const text = await withTimeout(options.call(member, attempt), timeoutMs)
        const note =
          hops.length === 0
            ? `model ${key} answered (attempt ${attempt})`
            : `failover: ${hops.join("; ")}; continued on ${key} (attempt ${attempt})`
        options.onNote?.(note)
        return { member, text, note }
      } catch (raw) {
        const error = normalizeCallError(raw)
        const cls = classifyChainError(error)
        if (cls === "terminal") {
          markDown(options.health, member, options.now(), `terminal: ${shortReason(error)}`)
          tried.push(key)
          hops.push(`${key} terminal (${shortReason(error)})`)
          break
        }
        if (attempt >= maxTransientAttempts) {
          markDown(options.health, member, options.now(), `transient, retries exhausted: ${shortReason(error)}`)
          tried.push(key)
          hops.push(`${key} transient, gave up after ${attempt} attempt(s) (${shortReason(error)})`)
          break
        }
        hops.push(`${key} transient, retry ${attempt}/${maxTransientAttempts} (${shortReason(error)})`)
      }
    }
  }
  const note = `failover: ${hops.join("; ") || "no healthy member"}; chain exhausted`
  options.onNote?.(note)
  throw new ChainExhaustedError(tried, note)
}
