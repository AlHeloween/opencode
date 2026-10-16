/**
 * In-request stream failover (t68, C3b): the decision core.
 *
 * Pure and clock-injected — the fake clock in the tests fires the same
 * transitions without sleeping. The Effect/Stream wiring lives in
 * `processor.ts`, which owns the abort, the parts and the retry policy;
 * this module owns the DECISION: when a member is done, who is next, and
 * what the visible note says.
 *
 * Rules (from the measured floor in `classify.ts`):
 * - hang past the first-token threshold: DOWN at once, next UP — retrying
 *   the same hanger for another full threshold is the loop the owner means;
 * - terminal refusal: DOWN at once, zero retries on the member;
 * - other transient: bounded retries on the SAME member, then DOWN + next;
 * - no UP member left: visible exhaustion, never an invented model.
 */
import { firstUp, markDown, memberKey } from "./chain"
import { classifyChainError } from "./classify"
import type { ChainErrorInput } from "./classify"
import type { ChainHealth, ChainMember } from "./chain"

export interface FirstTokenWatch {
  arm(): void
  notifyToken(): void
  cancel(): void
}

/**
 * Ordered in-stream marker: the processor renders it as the visible switch
 * note BEFORE the next member's chunks arrive. It carries no model text —
 * only which member, why, and the next one — so replay bytes of model
 * content are untouched by the switch itself.
 */
export interface ChainSwitchEvent {
  type: "chain-switch"
  prevKey: string
  nextKey: string
  reason: string
}

export function createFirstTokenWatch(options: {
  timeoutMs: number
  now: () => number
  schedule: (ms: number, cb: () => void) => () => void
  onTimeout: (elapsedMs: number) => void
}): FirstTokenWatch {
  let cancel: (() => void) | undefined
  let done = false
  const startedAt = options.now()
  return {
    arm() {
      if (done) return
      cancel?.()
      cancel = options.schedule(options.timeoutMs, () => {
        if (done) return
        done = true
        cancel = undefined
        options.onTimeout(options.now() - startedAt)
      })
    },
    notifyToken() {
      if (done) return
      done = true
      cancel?.()
      cancel = undefined
    },
    cancel() {
      done = true
      cancel?.()
      cancel = undefined
    },
  }
}

function shortReason(error: ChainErrorInput): string {
  const firstLine = error.message.split("\n")[0] ?? error.message
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine
}

export type StreamDecision =
  | { action: "retry-member"; member: ChainMember }
  | { action: "next"; member: ChainMember; reason: string; attemptsOnFailed: number }
  | { action: "exhausted"; tried: string[]; reason: string }

export function decideStreamError(options: {
  chain: ChainMember[]
  health: Map<string, ChainHealth>
  now: () => number
  error: ChainErrorInput
  failed?: ChainMember
  attemptsSoFar?: number
  maxTransientAttempts?: number
}): StreamDecision {
  const maxTransientAttempts = options.maxTransientAttempts ?? 2
  const failed = options.failed ?? firstUp(options.chain, options.health)
  if (!failed) {
    return { action: "exhausted", tried: [], reason: "no healthy member to try" }
  }
  const cls = classifyChainError(options.error)
  const toNext = (reason: string, attemptsOnFailed: number): StreamDecision => {
    markDown(options.health, failed, options.now(), reason)
    const next = firstUp(options.chain, options.health)
    if (!next) {
      const tried = options.chain
        .filter((member) => options.health.get(memberKey(member))?.status === "DOWN")
        .map((member) => memberKey(member))
      return { action: "exhausted", tried, reason }
    }
    return { action: "next", member: next, reason, attemptsOnFailed }
  }
  if (cls === "terminal") {
    return toNext(`terminal: ${shortReason(options.error)}`, 1)
  }
  if (options.error.code === "FIRST_TOKEN_TIMEOUT") {
    return toNext(`hang: ${shortReason(options.error)}`, 1)
  }
  const attempts = options.attemptsSoFar ?? 1
  if (attempts < maxTransientAttempts) {
    return { action: "retry-member", member: failed }
  }
  return toNext(`transient, retries exhausted: ${shortReason(options.error)}`, attempts)
}

export function buildSwitchNote(input: {
  prevKey: string
  nextKey: string
  reason: string
  keptChars: number
}): string {
  const kept = input.keptChars > 0 ? `${input.keptChars} chars kept` : "no partial text"
  return `[chain switch ${input.prevKey} → ${input.nextKey} (${input.reason}; ${kept})]`
}
