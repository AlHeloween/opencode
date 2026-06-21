import { Cause, Deferred, Effect, Layer, Context, Scope } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import { CacheControl } from "./cache-control"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { isRecord } from "@/util/record"
import { StringBuilder } from "@/util/string-builder"
import * as Balance from "@/provider/balance"
import * as BalanceStorage from "@/provider/balance-storage"
import { SessionTable } from "./session.sql"
import { eq, sql } from "drizzle-orm"
import { Database } from "@/storage/db"

const DOOM_LOOP_THRESHOLD = 3
const log = Log.create({ service: "session.processor" })
export type Result = "compact" | "stop" | "continue"

export type Event = LLM.Event

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  toolCallEmitted: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  textBuilder: StringBuilder
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  reasoningBuilders: Record<string, StringBuilder>
  recentToolCalls: { toolName: string; input: unknown }[]
}

type StreamEvent = Event

export function cacheRatio(tokens: { input: number; cache: { read: number; write: number } }) {
  return tokens.cache.read / Math.max(1, tokens.input + tokens.cache.read + tokens.cache.write)
}

const _lastBalanceCheck: Record<string, number> = {}
const BALANCE_CHECK_INTERVAL_MS = 300_000 // 5 minutes
const BALANCE_CHECK_MIN_COST = 0.01

async function checkAndSnapshotBalance(params: {
  providerID: string
  sessionID: string
  messageID: string
}): Promise<Balance.BalanceSnapshot | null> {
  const now = Date.now()
  const last = _lastBalanceCheck[params.providerID] ?? 0
  if (now - last < BALANCE_CHECK_INTERVAL_MS) return null
  _lastBalanceCheck[params.providerID] = now

  try {
    const previous = BalanceStorage.readLatestBalanceSnapshot(params.providerID)
    const calculatedCost = BalanceStorage.calculatedCostSinceLastSnapshot(
      params.sessionID,
      params.providerID,
    )
    if (previous && calculatedCost < BALANCE_CHECK_MIN_COST) return null

    const snapshot = await Balance.checkBalance({
      providerID: params.providerID,
      sessionID: params.sessionID,
      messageID: params.messageID,
      previousSnapshot: previous ?? undefined,
      calculatedCostSinceLast: calculatedCost,
    })
    if (snapshot) {
      BalanceStorage.writeBalanceSnapshot(snapshot)
    }
    return snapshot
  } catch (err) {
    log.warn("bug: balance snapshot failed", { error: String(err), sessionID: params.sessionID })
    return null
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Session.Service
  | Config.Service
  | Bus.Service
  | Snapshot.Service
  | Agent.Service
  | LLM.Service
  | Permission.Service
  | Plugin.Service
  | SessionSummary.Service
  | SessionStatus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        toolCallEmitted: false,
        needsCompaction: false,
        currentText: undefined,
        textBuilder: new StringBuilder(),
        reasoningMap: {},
        reasoningBuilders: {},
        recentToolCalls: [],
      }
      let aborted = false
      const slog = log.clone().tag("session.id", input.sessionID).tag("messageID", input.assistantMessage.id).tag("modelID", input.model.id)

      // Publish model status immediately on load / model switch so the TUI
      // shows balance (DeepSeek/OpenRouter) or usage (OpenAI) right away,
      // not just after a message completes.
      yield* Effect.gen(function* () {
        const status = yield* Effect.promise(() =>
          Balance.getModelStatus(input.model.providerID),
        )
        yield* bus.publish(Session.Event.ModelStatusUpdated, {
          sessionID: input.sessionID,
          providerID: input.model.providerID,
          type: status.type,
          ...(status.type === "balance"
            ? { currency: status.currency, totalBalance: status.totalBalance, isAvailable: status.isAvailable }
            : {}),
          ...(status.type === "usage"
            ? { windows: status.windows }
            : {}),
          ...(status.type === "unavailable"
            ? { reason: status.reason }
            : {}),
        })
      }).pipe(Effect.ignore, Effect.forkIn(scope))

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return
        }
        // eslint-disable-next-line consistent-return
        // eslint-disable-next-line consistent-return
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        // eslint-disable-next-line consistent-return
        // eslint-disable-next-line consistent-return
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      /** Create or retrieve a tool call part, returning its metadata. */
      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (value: {
        id: string; toolName: string; providerExecuted?: boolean
      }) {
        if (ctx.assistantMessage.summary) {
          throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
        }
        const part = yield* session.updatePart({
          id: ctx.toolcalls[value.id]?.partID ?? PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: value.toolName,
          callID: value.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
        } satisfies MessageV2.ToolPart)
        ctx.toolcalls[value.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
      })

      /** Flush pending reasoning text and finalize the reasoning part. */
      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (value: {
        id: string; providerMetadata?: Record<string, unknown>
      }) {
        if (!(value.id in ctx.reasoningMap)) return
        ctx.reasoningMap[value.id].text =
          ctx.reasoningBuilders[value.id]?.toString() ?? ctx.reasoningMap[value.id].text
        delete ctx.reasoningBuilders[value.id]
        ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
        if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
        yield* session.updatePart(ctx.reasoningMap[value.id])
        delete ctx.reasoningMap[value.id]
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "start":
            yield* status.set(ctx.sessionID, { type: "busy" })
            return

          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            ctx.reasoningBuilders[value.id] = new StringBuilder()
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            if (!(value.id in ctx.reasoningMap)) return
            if (ctx.reasoningBuilders[value.id]) ctx.reasoningBuilders[value.id].append(value.text)
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            yield* finishReasoning(value)
            return

          case "tool-input-start":
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            return

          case "tool-input-end":
            return

          case "tool-call": {
            ctx.toolCallEmitted = true
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
            }
            yield* updateToolCall(value.toolCallId, (match) => ({
              ...match,
              tool: value.toolName,
              state: {
                ...match.state,
                status: "running",
                input: value.input,
                time: { start: Date.now() },
              },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            ctx.recentToolCalls.push({ toolName: value.toolName, input: value.input })
            if (ctx.recentToolCalls.length > DOOM_LOOP_THRESHOLD) ctx.recentToolCalls.shift()

            const last = ctx.recentToolCalls
            if (
              last.length !== DOOM_LOOP_THRESHOLD ||
              !last.every((c) => c.toolName === value.toolName && Bun.deepEquals(c.input, value.input))
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.toolName],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.toolName, input: value.input },
              always: [value.toolName],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            yield* completeToolCall(value.toolCallId, value.output)
            return
          }

          case "tool-error": {
            yield* failToolCall(value.toolCallId, value.error)
            return
          }

          case "error":
            if (
              typeof value.error === "string" &&
              value.error.includes("text part") &&
              value.error.includes("not found")
            ) {
              log.warn("ai-sdk text part error (known issue, ignoring)", {
                error: value.error,
                sessionId: ctx.sessionID,
                messageId: ctx.assistantMessage.id,
              })
              return
            }
            throw value.error

          case "start-step":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "finish-step": {
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.finishReason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            if (usage.tokens.input > 0 || usage.tokens.cache.read > 0 || usage.tokens.cache.write > 0) {
              const cacheWarm = Session.isCacheWarm(usage.tokens)
              log.info(cacheWarm ? "cache hit" : "cache miss", {
                sessionID: ctx.sessionID,
                modelID: ctx.model.id,
                cacheRatio: cacheRatio(usage.tokens),
                inputTokens: usage.tokens.input,
                cacheReadTokens: usage.tokens.cache.read,
                cacheWriteTokens: usage.tokens.cache.write,
              })

              // Post-send cache audit: compare actual DeepSeek cache behavior
              // against our pre-send MD5 prediction. Log mismatches as miscalculations.
              const prevFP = CacheControl.getPrevFingerprint(ctx.sessionID, ctx.model.id)
              if (prevFP) {
                // Pre-send prediction: audit.estimatedHitRatio > 0 means we expected some cache hits
                const predictedWarm = prevFP.estimatedTokens > 0
                if (predictedWarm !== cacheWarm) {
                  log.warn("bug: cache miscalculation", {
                    sessionID: ctx.sessionID,
                    modelID: ctx.model.id,
                    predicted: predictedWarm ? "warm" : "cold",
                    actual: cacheWarm ? "warm" : "cold",
                    actualCacheRead: usage.tokens.cache.read,
                    actualCacheWrite: usage.tokens.cache.write,
                    actualInputTokens: usage.tokens.input,
                    fingerprint: prevFP.fullMd5,
                  })
                }
              }
            }
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.finishReason,
              snapshot: yield* snapshot.track(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            // Accumulate session-level token/cost totals
            yield* Effect.sync(() =>
              Database.use((db) =>
                db
                  .update(SessionTable)
                  .set({
                    cost: sql`cost + ${usage.cost}`,
                    tokens_input: sql`tokens_input + ${usage.tokens.input + usage.tokens.cache.read}`,
                    tokens_output: sql`tokens_output + ${usage.tokens.output}`,
                    tokens_reasoning: sql`tokens_reasoning + ${usage.tokens.reasoning}`,
                    tokens_cache_read: sql`tokens_cache_read + ${usage.tokens.cache.read}`,
                    tokens_cache_write: sql`tokens_cache_write + ${usage.tokens.cache.write}`,
                  })
                  .where(eq(SessionTable.id, ctx.sessionID))
                  .run(),
              ),
            )
            // Snapshot provider status and publish for TUI display.
            yield* Effect.gen(function* () {
              // Cost-validation snapshot (internal)
              const snapshot = yield* Effect.promise(() =>
                checkAndSnapshotBalance({
                  providerID: ctx.model.providerID,
                  sessionID: ctx.sessionID,
                  messageID: ctx.assistantMessage.id,
                }),
              )
              if (snapshot) {
                yield* bus.publish(Session.Event.BalanceUpdated, {
                  sessionID: ctx.sessionID,
                  providerID: snapshot.providerID,
                  currency: snapshot.currency,
                  totalBalance: snapshot.totalBalance,
                  grantedBalance: snapshot.grantedBalance,
                  toppedUpBalance: snapshot.toppedUpBalance,
                  isAvailable: snapshot.isAvailable,
                  calculatedCostSinceLast: snapshot.calculatedCostSinceLast,
                  costValidationDelta: snapshot.costValidationDelta,
                })
              }
              // Standardised model status (balance / usage / unavailable)
              const status = yield* Effect.promise(() =>
                Balance.getModelStatus(ctx.model.providerID),
              )
              yield* bus.publish(Session.Event.ModelStatusUpdated, {
                sessionID: ctx.sessionID,
                providerID: ctx.model.providerID,
                type: status.type,
                ...(status.type === "balance"
                  ? { currency: status.currency, totalBalance: status.totalBalance, isAvailable: status.isAvailable }
                  : {}),
                ...(status.type === "usage"
                  ? { windows: status.windows }
                  : {}),
                ...(status.type === "unavailable"
                  ? { reason: status.reason }
                  : {}),
              })
            }).pipe(Effect.ignore, Effect.forkIn(scope))
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            ctx.textBuilder.reset()
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.textBuilder.append(value.text)
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            ctx.currentText.text = ctx.textBuilder.toString()
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return

          default:
            slog.info("unhandled", { event: value.type, value })
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.text = ctx.textBuilder.toString()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          const builder = ctx.reasoningBuilders[part.id]
          yield* session.updatePart({
            ...part,
            text: builder ? builder.toString() : part.text,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}
        ctx.reasoningBuilders = {}

        const pendingToolCalls = Object.entries(ctx.toolcalls)
        yield* Effect.forEach(
          pendingToolCalls.map(([, call]) => call),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const [toolCallID] of pendingToolCalls) {
          if (!ctx.toolcalls[toolCallID]) continue
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            if (aborted && !ctx.assistantMessage.error) {
              ctx.assistantMessage.error = parse(new DOMException("Aborted", "AbortError"))
            }
            if (ctx.assistantMessage.error && !ctx.assistantMessage.finish) {
              ctx.assistantMessage.finish = "error"
            }
            ctx.assistantMessage.time.completed = Date.now()
            yield* session.updateMessage(ctx.assistantMessage)
          }),
        )
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true
          yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        ctx.assistantMessage.error = error
        ctx.assistantMessage.finish = "error"
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.textBuilder.reset()
            ctx.reasoningMap = {}
            ctx.reasoningBuilders = {}
            const stream = llm.stream(streamInput)

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* Effect.uninterruptible(halt(new DOMException("Aborted", "AbortError")))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                parse,
                set: (info) =>
                  status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    next: info.next,
                  }),
              }),
            ),
            Effect.interruptible,
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* Effect.uninterruptible(halt(new DOMException("Aborted", "AbortError")))
                }
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(Effect.uninterruptible(cleanup())),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)

export * as SessionProcessor from "./processor"
