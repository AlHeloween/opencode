import type { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import * as Log from "@opencode-ai/core/util/log"
import { firstUp, markDown, memberKey } from "@/provider/model-chain/chain"
import { classifyChainError, parseRetryAfterMs } from "@/provider/model-chain/classify"
import type { ChainErrorInput } from "@/provider/model-chain/classify"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"

export type Err = ReturnType<NamedError["toObject"]>

// This exported message is shared with the TUI upsell detector. Matching on a
// literal error string kind of sucks, but it is the simplest for now.
export const GO_UPSELL_MESSAGE = "Free usage exceeded, subscribe to Go https://opencode.ai/go"

export const EMPTY_RESPONSE_MAX_ATTEMPTS = 5

export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          return cap(parsedMs)
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return cap(Math.ceil(parsedSeconds * 1000))
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return cap(Math.ceil(parsed))
        }
      }

      return cap(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1))
    }
  }

  return cap(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS))
}

export function retryable(error: Err) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  // Empty response (finishReason="other" with 0 output tokens) — transient
  // provider stream disconnect. Retryable up to EMPTY_RESPONSE_MAX_ATTEMPTS.
  if (MessageV2.EmptyResponseError.isInstance(error)) {
    return error.data.message
  }
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
    if (error.data.responseBody?.includes("FreeUsageLimitError")) return GO_UPSELL_MESSAGE
    return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
  }

  // Check for rate limit patterns in plain text error messages
  const msg = error.data?.message
  if (typeof msg === "string") {
    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return msg
    }
  }

  const json = iife(() => {
    try {
      if (typeof error.data?.message === "string") {
        const parsed = JSON.parse(error.data.message)
        return parsed
      }

      return JSON.parse(error.data.message)
    } catch (e) {
      Log.Default.warn("bug: failed to parse retryable error message", { error: String(e), raw: error.data?.message })
      return undefined
    }
  })
  if (!json || typeof json !== "object") return undefined
  const errorCode = typeof json.code === "string" ? json.code : ""

  // Groq TPM (tokens per minute) limit errors are NOT transient — the limit
  // won't change after a delay. Don't retry; let the user see the error.
  if (json.type === "error" && errorCode.includes("rate_limit_exceeded")) {
    return undefined
  }
  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return "Too Many Requests"
  }
  if (errorCode.includes("exhausted") || errorCode.includes("unavailable")) {
    return "Provider is overloaded"
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return "Rate Limited"
  }
  return undefined
}

export function policy(opts: {
  parse: (error: unknown) => Err
  set: (input: { attempt: number; message: string; next: number }) => Effect.Effect<void>
  maxAttempts?: number
  decideChainSwitch?: (error: Err) => Effect.Effect<string | false>
}) {
  const max = opts.maxAttempts ?? Infinity
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      const error = opts.parse(meta.input)
      const message = retryable(error)
      if (!message) return Cause.done(meta.attempt)
      // EmptyResponseError has a hard cap (default 5). Other errors (API 5xx,
      // rate limits) retry indefinitely — transient provider issues may resolve
      // after a longer wait.
      const isEmptyResponse = MessageV2.EmptyResponseError.isInstance(error)
      if (isEmptyResponse && meta.attempt >= max) {
        Log.Default.warn("retry: max attempts exhausted for empty response", {
          attempt: meta.attempt,
          maxAttempts: max,
          error: message,
        })
        return Cause.done(meta.attempt)
      }
      return Effect.gen(function* () {
        // Chain first: a terminal chain refusal switches members instead of
        // waiting out the provider-ordered delay (t68 live: 429 +
        // retry-after ~12h held the session busy with no switch and no mark).
        if (opts.decideChainSwitch) {
          // A switch names itself: the returned message (failed → next model,
          // code, retry-after) becomes the visible retry status, and the wait
          // is zero — the session continues on the next member at once.
          const switchMessage = yield* opts.decideChainSwitch(error)
          if (switchMessage) {
            const now = yield* Clock.currentTimeMillis
            yield* opts.set({ attempt: meta.attempt, message: switchMessage, next: now })
            return [meta.attempt, Duration.millis(0)] as [number, Duration.Duration]
          }
        }
        const wait = delay(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
        const now = yield* Clock.currentTimeMillis
        yield* opts.set({ attempt: meta.attempt, message, next: now + wait })
        return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
      })
    }),
  )
}

/**
 * Session-retry chain consultation (t68): ask the explicit model chain
 * BEFORE the retry policy waits out a provider-ordered delay. A terminal
 * chain refusal (balance text, unknown-field, auth, model-not-found, or a
 * retry-after beyond the measured first-token floor) marks the failed member
 * DOWN and resolves the next UP member — the caller adopts its model and
 * emits the visible note, and the retry continues immediately (zero wait).
 * Anything else (non-terminal, empty chain, unresolvable next) returns
 * undefined and the normal wait path runs untouched — including the
 * midnight recovery of a lone exhausted member.
 */
export interface SessionChainEnv<TModel> {
  load: (scope: string, agent: string) => ChainMember[] | undefined
  health: Map<string, ChainHealth>
  resolveModel: (member: ChainMember) => Effect.Effect<TModel | undefined>
  noteSwitch: (note: { prevKey: string; nextKey: string; reason: string }) => Effect.Effect<void>
}

export interface SessionChainSwitch<TModel> {
  member: ChainMember
  model: TModel
  reason: string
}

export function consultChainSwitch<TModel>(opts: {
  sessionID: string
  agent: string
  model: { providerID: string; modelID: string }
  error: Err
  now: () => number
  env: SessionChainEnv<TModel>
}): Effect.Effect<SessionChainSwitch<TModel> | undefined> {
  return Effect.gen(function* () {
    // Best-effort enhancement, never a new failure mode: any doubt falls
    // through to the normal wait below.
    try {
      if (!MessageV2.APIError.isInstance(opts.error)) return undefined
      const data = opts.error.data
      const input: ChainErrorInput = {
        message: data.responseBody ? `${data.message}\n${data.responseBody}` : data.message,
        statusCode: data.statusCode,
        retryAfterMs: parseRetryAfterMs(data.responseHeaders),
      }
      if (classifyChainError(input) !== "terminal") return undefined
      const failed: ChainMember = { providerID: opts.model.providerID, modelID: opts.model.modelID }
      const chain = opts.env.load(`session:${opts.sessionID}`, opts.agent) ?? []
      if (chain.length === 0) return undefined
      const firstLine = input.message.split("\n")[0] ?? input.message
      const detail = [
        input.statusCode !== undefined ? `${input.statusCode}` : undefined,
        input.retryAfterMs !== undefined ? `retry-after ${Math.round(input.retryAfterMs / 1000)}s` : undefined,
      ].filter((part) => part !== undefined).join(", ")
      const reason = `terminal: ${firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine}${detail ? ` (${detail})` : ""}`
      markDown(opts.env.health, failed, opts.now(), reason)
      const next = firstUp(chain, opts.env.health)
      if (!next) return undefined
      const model = yield* opts.env.resolveModel(next)
      if (model === undefined) return undefined
      const note = { prevKey: memberKey(failed), nextKey: memberKey(next), reason }
      yield* opts.env.noteSwitch(note)
      return { member: next, model, reason }
    } catch {
      return undefined
    }
  })
}

export * as SessionRetry from "./retry"
