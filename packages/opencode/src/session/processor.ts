import { Cause, Deferred, Effect, Layer, Context, Scope } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as SnapshotFossil from "@/snapshot/fossil"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow, usable } from "./overflow"
import { TokenCalibration } from "./token-calibration"
import { ProviderError } from "@/provider/error"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"

import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Constitution } from "./constitution"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { isRecord } from "@/util/record"
import { StringBuilder } from "@/util/string-builder"
import {
  normalizeDsmlTokens,
  detectDisguisedToolCalls,
  DEFAULT_KNOWN_TOOL_IDS,
  knownToolIdsForTurn,
} from "@/util/dsml-normalizer"
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
  agentName?: string
  /** Estimated cumulative content tokens across all non-compacted messages.
    * Passed from prompt loop to enable mid-turn overflow detection
    * that accounts for full session context, not just per-turn tokens. */
  contentTokenEstimate?: number
  /** Epistemic floor of the current turn's evidence chain.
    * Inferred by default; upgraded to Exact after session-read.
    * Used to inject epistemic nudges before destructive tool calls. */
  evidenceFloor?: import("../session/constitution").InfoMark
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
  streamStartTime: number | undefined
  firstTokenLogged: boolean
  hasWriteToolCall: boolean
  changedFiles: Set<string>
  /** Cumulative context token estimate from prompt loop. */
  contentTokenEstimate?: number
  /** Epistemic floor — always resolved by create() from optional Input. */
  evidenceFloor: import("../session/constitution").InfoMark
  /** Wire tool ids for this turn (default + live tools). Set in process(). */
  knownToolIds: ReadonlySet<string>
}

type StreamEvent = Event

/**
 * Provider-canonical tool names that can modify the working copy.
 * Snapshot tracking only needed after these (names must match wire form, e.g. applypatch).
 */
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "applypatch", "bash", "run", "task", "pipeline"])

/** True only for the exact provider tool id (canonical), not legacy separator forms. */
export function writesWorkingCopy(toolName: string) {
  return WRITE_TOOLS.has(toolName)
}

/** True only for the exact provider tool id that yields Exact evidence. */
export function providesExactEvidence(toolName: string) {
  return toolName === "sessionread"
}

export function cacheRatio(tokens: { input: number; cache: { read: number; write: number } }) {
  return tokens.cache.read / Math.max(1, tokens.input + tokens.cache.read + tokens.cache.write)
}

/**
 * T3: warn when a single step injects more than this many prompt tokens.
 * Injected blocks are billed at full miss price on the next request until
 * they become a persisted cache prefix unit (observed 32K-68K injections).
 */
export const CACHE_INJECTION_WARN_TOKENS = 24_576

/** Per session+provider+model last prompt-token total for injection detection. */
const lastPromptTokens = new Map<string, number>()

/** Pure T3 check: returns the injection delta when it exceeds the threshold. */
export function injectionDelta(
  previousTotal: number | undefined,
  currentTotal: number,
  threshold: number,
): number | undefined {
  if (previousTotal === undefined) return undefined
  const delta = currentTotal - previousTotal
  return delta > threshold ? delta : undefined
}

/** Pure P4 check: returns the shrink size when the prefix reset below the threshold. */
export function prefixResetDelta(
  previousTotal: number | undefined,
  currentTotal: number,
  threshold: number,
): number | undefined {
  if (previousTotal === undefined) return undefined
  const shrink = previousTotal - currentTotal
  return shrink > threshold ? shrink : undefined
}

export interface StepTokens {
  total?: number
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
    hitRateIsNull?: number
  }
  cacheRatio?: number
}

/**
 * Pure T4 aggregation: sum per-step usage across all steps of one assistant
 * message. Prevents the old bug where message tokens held only the last
 * step's usage, mixing per-step input with cumulative cache.read.
 */
export function accumulateStepTokens(
  accumulated: StepTokens | undefined,
  step: StepTokens,
  cacheState?: Session.CacheState,
): StepTokens {
  if (!accumulated) {
    return {
      ...step,
      cache: {
        ...step.cache,
        ...(cacheState ? { hitRateIsNull: cacheState === "unknown" ? 1 : 0 } : {}),
      },
    }
  }
  const read = accumulated.cache.read + step.cache.read
  const write = accumulated.cache.write + step.cache.write
  const input = accumulated.input + step.input
  const hitRateIsNull = cacheState ? (cacheState === "unknown" ? 1 : 0) : accumulated.cache.hitRateIsNull
  return {
    total: (accumulated.total ?? 0) + (step.total ?? 0),
    input,
    output: accumulated.output + step.output,
    reasoning: accumulated.reasoning + step.reasoning,
    cache: { read, write, ...(hitRateIsNull !== undefined ? { hitRateIsNull } : {}) },
    cacheRatio: read / Math.max(1, input + read + write),
  }
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
      // Reuse the current Fossil checkpoint before streaming. Reconciling the
      // full working tree here blocks every tool-loop iteration, including
      // read-only turns that have no filesystem state to capture.
      const initialSnapshot = yield* snapshot.checkpoint()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        agentName: input.agentName,
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
        knownToolIds: DEFAULT_KNOWN_TOOL_IDS,
        streamStartTime: undefined,
        firstTokenLogged: false,
        hasWriteToolCall: false,
        changedFiles: new Set<string>(),
        evidenceFloor: input.evidenceFloor ?? "Inferred",
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
        // Epistemic nudge: if evidence floor is not Exact and this is a
        // mutation/destructive tool, prepend a verification reminder.
        const nudge = Constitution.epistemicNudge({
          tool: match.part.tool,
          evidenceFloor: ctx.evidenceFloor,
          command: (match.part.state.input as any)?.command,
          sessionID: ctx.sessionID,
        })
        const finalOutput = nudge ? nudge + "\n" + output.output : output.output
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: finalOutput,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        // Track changed files for snapshot
        const filediff = output.metadata?.filediff as { file?: string } | undefined
        if (filediff?.file) ctx.changedFiles.add(filediff.file)
        yield* settleToolCall(toolCallID)
      })

      /** Create or retrieve a tool call part, returning its metadata. */
      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (value: {
        id: string; toolName: string; providerExecuted?: boolean
      }) {
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
            ctx.streamStartTime = Date.now()
            yield* status.set(ctx.sessionID, { type: "busy" })
            return

          case "reasoning-start":
            if (!ctx.firstTokenLogged && ctx.streamStartTime) {
              ctx.firstTokenLogged = true
              log.info("ttfb", {
                durationMs: Date.now() - ctx.streamStartTime,
                tokenType: "reasoning",
              })
            }
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
            if (writesWorkingCopy(value.toolName)) ctx.hasWriteToolCall = true
            // Raise coarse floor from evidence tools (sessionread / read / codegraph → Exact).
            if (providesExactEvidence(value.toolName)) {
              ctx.evidenceFloor = "Exact"
              Constitution.raiseEvidenceFloor(ctx.sessionID, "Exact")
            } else {
              const upgrade = Constitution.evidenceUpgradeForTool(value.toolName)
              if (upgrade) {
                ctx.evidenceFloor = upgrade
                Constitution.raiseEvidenceFloor(ctx.sessionID, upgrade)
              }
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

          case "file": {
            const fileValue = value as { mediaType?: string; mime?: string; url?: string; filename?: string }
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "file",
              mime: fileValue.mediaType ?? fileValue.mime ?? "application/octet-stream",
              url: fileValue.url ?? "",
              ...(fileValue.filename ? { filename: fileValue.filename } : {}),
            } satisfies MessageV2.FilePart)
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
            // snapshot already captured at processor create — no need to re-track
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "finish-step": {
            // RAW cache read BEFORE getUsage collapses null → 0: KAT and other
            // gateways return cached_tokens: null on hits — null ≠ miss.
            const rawCacheRead = value.usage.inputTokenDetails?.cacheReadTokens
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage,
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.finishReason
            // Level 2: DeepSeek V4 Pro bug — inline tool calls in content.
            // Model emits finish_reason="stop" but text contains tool_name{...}.
            // Extract disguised tool calls and trigger retry.
            // NOTE: ctx.currentText is cleared by text-end before finish-step fires,
            // so we check ctx.textBuilder instead (accumulated across all text deltas).
            if (value.finishReason === "stop" && ctx.textBuilder.length >= 10) {
              const text = ctx.textBuilder.toString()
              // Allowlist: defaults + live tools for this turn (plugin/MCP included).
              const disguised = detectDisguisedToolCalls(
                value.finishReason,
                text,
                ctx.knownToolIds,
              )
              if (disguised && disguised.length > 0) {
                const names = disguised.map((t) => t.name).join(", ")
                log.warn("detected disguised tool calls in content — triggering retry", {
                  sessionID: ctx.sessionID,
                  tools: names,
                })
                ctx.assistantMessage.error = {
                  name: "UnknownError",
                  message:
                    `DeepSeek tool-call format error: you wrote tool calls (${names}) as plain text instead of structured tool_calls. ` +
                    `Regenerate using the proper tool calling mechanism — do NOT write [tool:XXX] or function_name{...} inline in the text.`,
                } as any
              }
            }
            log.info("finish-step", {
              sessionID: ctx.sessionID,
              modelID: ctx.model.id,
              finishReason: value.finishReason,
              inputTokens: usage.tokens.input,
              outputTokens: usage.tokens.output,
            })
            // T3 guard: large prompt injections bill at full miss price on the
            // next request (provider prompt caches only reuse persisted prefix
            // units). Warn early so heavy tool turns are visible before the bill.
            const promptTotal = usage.tokens.input + usage.tokens.cache.read + usage.tokens.cache.write
            const injectionKey = `${ctx.sessionID}\0${ctx.model.providerID}\0${ctx.model.id}`
            const previous = lastPromptTokens.get(injectionKey)
            const deltaTokens = injectionDelta(previous, promptTotal, CACHE_INJECTION_WARN_TOKENS)
            if (deltaTokens !== undefined) {
              const missRate = ctx.model.cost?.input ?? 0
              log.warn("cache: large injection — new block pays full miss price", {
                sessionID: ctx.sessionID,
                modelID: ctx.model.id,
                providerID: ctx.model.providerID,
                deltaTokens,
                estMissCostUsd: Number(((deltaTokens * missRate) / 1_000_000).toFixed(6)),
              })
            }
            const shrink = prefixResetDelta(previous, promptTotal, CACHE_INJECTION_WARN_TOKENS)
            if (shrink !== undefined) {
              log.warn("cache: prefix reset — next turns re-prefill from cold (compaction/model switch?)", {
                sessionID: ctx.sessionID,
                modelID: ctx.model.id,
                providerID: ctx.model.providerID,
                shrinkTokens: shrink,
              })
            }
            lastPromptTokens.set(injectionKey, promptTotal)
            const hasCacheUsage = usage.tokens.input > 0 || usage.tokens.cache.read > 0 || usage.tokens.cache.write > 0
            const cacheState = hasCacheUsage ? Session.classifyCacheRead(rawCacheRead) : undefined
            ctx.assistantMessage.cost += usage.cost
            // T4: aggregate tokens across all steps of this assistant message.
            // Previous behaviour stored only the LAST step's usage, mixing
            // per-step input with cumulative cache.read into a misleading ratio.
            ctx.assistantMessage.tokens = accumulateStepTokens(ctx.assistantMessage.tokens, usage.tokens, cacheState)
            if (cacheState) {
              log.info(cacheState === "hit" ? "cache hit" : cacheState === "miss" ? "cache miss" : "cache unknown", {
                sessionID: ctx.sessionID,
                modelID: ctx.model.id,
                cacheState,
                cacheRatio: cacheRatio(usage.tokens),
                inputTokens: usage.tokens.input,
                cacheReadTokens: usage.tokens.cache.read,
                cacheWriteTokens: usage.tokens.cache.write,
                totalDurationMs: ctx.streamStartTime ? Date.now() - ctx.streamStartTime : undefined,
              })
            }
            // Save the pre-track snapshot for patch diffing.
            // ctx.snapshot holds the hash BEFORE this tool step ran.
            // track() commits the changes and returns the NEW hash, but
            // patch() needs the BEFORE hash to diff against HEAD.
            const snapshotBeforeTrack = ctx.snapshot
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.finishReason,
              snapshot: ctx.hasWriteToolCall
                ? yield* snapshot.track([...ctx.changedFiles])
                : ctx.snapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              ...(cacheState && { cacheState }),
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
                    ...(cacheState && {
                      hit_rate_is_null: cacheState === "unknown" ? 1 : 0,
                    }),
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
            // Use the pre-track snapshot for patch — it represents the hash
            // BEFORE this tool's changes, so diffing from it to HEAD shows
            // exactly what files were modified.
            if (snapshotBeforeTrack) {
              const patch = yield* snapshot.patch(snapshotBeforeTrack)
              if (patch.files.length) {
                // Soft-warn: empty/missing hash would make future undo fail-loud (SP-05)
                if (!patch.hash || patch.hash.length < 8) {
                  log.warn("bug: patch part has weak snapshot hash", {
                    sessionID: ctx.sessionID,
                    hash: patch.hash,
                    files: patch.files.length,
                  })
                }
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
            }
            ctx.snapshot = undefined
            // Call sequentially (not forked) so the DB write from
            // session.updatePart above is committed before summarize
            // reads messages from the same DB connection.
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
            if (
              !ctx.assistantMessage.summary &&
              (isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model }) ||
                (ctx.contentTokenEstimate !== undefined &&
                  ctx.contentTokenEstimate >= usable({ cfg: yield* config.get(), model: ctx.model })))
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            if (!ctx.firstTokenLogged && ctx.streamStartTime) {
              ctx.firstTokenLogged = true
              log.info("ttfb", {
                durationMs: Date.now() - ctx.streamStartTime,
                tokenType: "text",
              })
            }
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
            const normalizedDelta = normalizeDsmlTokens(value.text)
            ctx.textBuilder.append(normalizedDelta)
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
            // Markdown repair is intentionally skipped for model-generated text.
            // The model's text is preserved verbatim.
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            // Claim ledger + oracle_stamp: system-owned InfoMark promotion path.
            {
              const ing = Constitution.ingestAssistantText(ctx.sessionID, ctx.currentText.text)
              if (ing.ledgerUpdated || ing.stampsApplied.length || ing.demoted.length) {
                log.debug("claim_ledger.ingest", {
                  sessionID: ctx.sessionID,
                  stamps: ing.stampsApplied,
                  demoted: ing.demoted,
                  floor: Constitution.decisionFloor(ctx.sessionID),
                })
                ctx.evidenceFloor = Constitution.decisionFloor(ctx.sessionID)
              }
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
          // BUG-5 fix: commit any pending write-tool changes before computing
          // the patch. Without this, snapshot.patch() diffs against the
          // uncommitted working tree, mixing committed and uncommitted changes
          // into a single aggregate patch that loses per-step granularity.
          if (ctx.hasWriteToolCall && ctx.changedFiles.size > 0) {
            yield* snapshot.track([...ctx.changedFiles]).pipe(Effect.catch(() => Effect.void))
          }
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
          (call) => Deferred.await(call.done).pipe(Effect.timeout("10 seconds"), Effect.ignore),
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
          // Calibrate token estimator from provider's ground-truth error message
          const tokenInfo = ProviderError.extractTokenLimits(error.data.message)
          if (tokenInfo.contextLimit || tokenInfo.inputTokens) {
            TokenCalibration.update(ctx.model, tokenInfo, ctx.assistantMessage.tokens?.input)
          }
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
        // Live tools this turn (plugin/MCP) + built-in defaults for disguised-call allowlist.
        ctx.knownToolIds = knownToolIdsForTurn(streamInput.tools as Record<string, unknown>)
        // Sub-agents: don't stop on a single denied tool — let the LLM retry with
        // a different tool. Primary agents respect continue_loop_on_deny config.
        const parentSession = yield* session.get(ctx.sessionID).pipe(
          Effect.map((s) => s.parentID ? true : false),
          Effect.catch(() => Effect.succeed(false)),
        )
        const configBreak = (yield* config.get()).experimental?.continue_loop_on_deny === true
        ctx.shouldBreak = parentSession ? false : !configBreak

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
    Layer.provide(SnapshotFossil.defaultLayer),
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
