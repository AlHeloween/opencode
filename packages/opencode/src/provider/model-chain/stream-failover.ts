/**
 * In-request stream failover (t68, C3b): the decision core.
 *
 * Pure and clock-injected — the fake clock in the tests fires the same
 * transitions without sleeping. The attempt walk (`runChainStream`) lives
 * here too, on injected run/resolve/clock seams; `session/llm.ts runChain`
 * only binds the live seams (provider run, `provider.getModel`, real clock);
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
import { Cause, Effect, Option } from "effect"
import * as Stream from "effect/Stream"
import { firstUp, markDown, memberKey } from "./chain"
import { classifyChainError, parseRetryAfterMs } from "./classify"
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

/**
 * Raw provider/stream failure onto the one question failover asks.
 * Duck-typed (numeric `statusCode`, record `responseHeaders`) because stream
 * failures arrive as SDK error objects, never as our own schema: the t73 429
 * carried its wait in `responseHeaders["retry-after"]`, and dropping the
 * headers is what let the retry policy wait it out (~14h).
 */
export function toChainError(e: unknown): ChainErrorInput {
  const message = e instanceof Error ? e.message : String(e)
  const record = (typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >
  const statusCode = typeof record.statusCode === "number" ? record.statusCode : undefined
  const headers = record.responseHeaders
  const retryAfterMs =
    typeof headers === "object" && headers !== null ? parseRetryAfterMs(headers as Record<string, string>) : undefined
  return { message, statusCode, retryAfterMs }
}

export interface ChainStreamDeps<TChunk, TModel, TErr = never, R = never> {
  chain: ChainMember[]
  initialModel: TModel
  memberOf: (model: TModel) => ChainMember | undefined
  modelKey: (model: TModel) => string
  run: (model: TModel, abort: AbortSignal) => Effect.Effect<{ stream: AsyncIterable<TChunk> }, TErr, R>
  resolveModel: (member: ChainMember) => Effect.Effect<TModel | undefined, TErr, R>
  health: Map<string, ChainHealth>
  timeoutMs: number
  now: () => number
  schedule: (ms: number, cb: () => void) => () => void
  maxTransientAttempts?: number
}

/**
 * In-request chain walk as a Stream (t68, t73 live finding): stream-PHASE
 * failures re-enter the same decision the setup phase uses. A 429 arriving
 * after the stream started used to bypass the old try/catch (which only
 * covered setup) and land in the processor retry policy, which waited out
 * `retry-after` (~14h busy on t73). Here every phase funnels through
 * `decideStreamError`: DOWN + next member with a visible note, or the
 * original cause rethrown — never an invented model, never a silent wait.
 *
 * Defects (and anything that is not a failed value) are never misread as a
 * failover trigger — the same rule user-cancel relies on.
 */
export function runChainStream<TChunk, TModel, TErr = never, R = never>(
  deps: ChainStreamDeps<TChunk, TModel, TErr, R>,
): Stream.Stream<unknown, TErr | Error, R> {
  const maxTransientAttempts = deps.maxTransientAttempts ?? 2
  let pendingNote: ChainSwitchEvent | undefined
  const buildAttempt = (
    current: { model: TModel; member: ChainMember | undefined },
    attemptsOnCurrent: number,
  ): Stream.Stream<unknown, TErr | Error, R> => {
    const state = { timedOut: false, cancel: undefined as (() => void) | undefined }
    const disarm = () => {
      state.cancel?.()
      state.cancel = undefined
    }
    const opened = Stream.unwrap(
      Effect.gen(function* () {
        const attemptCtrl = new AbortController()
        const result = yield* deps.run(current.model, attemptCtrl.signal)
        state.cancel = deps.schedule(deps.timeoutMs, () => {
          state.timedOut = true
          attemptCtrl.abort()
        })
        const watched = (async function* (): AsyncGenerator<TChunk | ChainSwitchEvent> {
          try {
            if (pendingNote) {
              const note = pendingNote
              pendingNote = undefined
              yield note
            }
            let firstSeen = false
            for await (const chunk of result.stream) {
              if (!firstSeen) {
                firstSeen = true
                disarm()
              }
              yield chunk
            }
          } finally {
            disarm()
          }
        })()
        return Stream.fromAsyncIterable(watched, (e) => (e instanceof Error ? e : new Error(String(e))))
      }),
    )
    return Stream.catchCause(opened, (cause) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const failure = Cause.findErrorOption(cause)
          if (Option.isNone(failure)) return Stream.failCause(cause)
          const error: ChainErrorInput = state.timedOut
            ? { code: "FIRST_TOKEN_TIMEOUT", message: `no first token within ${deps.timeoutMs}ms` }
            : toChainError(failure.value)
          const decision = decideStreamError({
            chain: deps.chain,
            health: deps.health,
            now: deps.now,
            failed: current.member,
            error,
            attemptsSoFar: attemptsOnCurrent,
            maxTransientAttempts,
          })
          if (decision.action === "retry-member") return buildAttempt(current, attemptsOnCurrent + 1)
          if (decision.action === "next") {
            let target = decision.member
            let targetModel: TModel | undefined
            for (;;) {
              const resolved = yield* deps.resolveModel(target)
              if (resolved !== undefined) {
                targetModel = resolved
                break
              }
              const gone = decideStreamError({
                chain: deps.chain,
                health: deps.health,
                now: deps.now,
                failed: target,
                error: { message: `Model not found: ${memberKey(target)}` },
              })
              if (gone.action !== "next") return Stream.failCause(cause)
              pendingNote = {
                type: "chain-switch",
                prevKey: memberKey(target),
                nextKey: memberKey(gone.member),
                reason: gone.reason,
              }
              target = gone.member
            }
            pendingNote = {
              type: "chain-switch",
              prevKey: current.member ? memberKey(current.member) : deps.modelKey(current.model),
              nextKey: memberKey(target),
              reason: decision.reason,
            }
            if (targetModel === undefined) return Stream.failCause(cause)
            return buildAttempt({ model: targetModel, member: target }, 1)
          }
          return Stream.failCause(cause)
        }),
      ),
    )
  }
  return buildAttempt({ model: deps.initialModel, member: deps.memberOf(deps.initialModel) }, 1)
}
