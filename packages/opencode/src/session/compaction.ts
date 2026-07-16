/**
 * Algorithmic Compaction
 * =====================
 *
 * It's NOT an AI problem — it's an information theory problem.
 *
 * Shannon's rate-distortion theory (1948) proves there is a fundamental
 * mathematical bound: you cannot compress information below the source
 * entropy without guaranteed distortion.  For conversation summarization:
 *
 *   R(D) → H(source) as D → 0
 *
 * Meaning: to preserve ALL actionable detail (D ≈ 0), you need as many
 * bits as the original.  A 500K-token conversation cannot be losslessly
 * compressed into a 2K-token summary — not by an LLM, not by a human.
 * The information simply isn't there.
 *
 * The old design asked for the impossible on every cycle: spawn a
 * compaction agent, feed it 300K+ tokens, expect a faithful summary.
 * The results were unreliable by physical necessity, not by model
 * weakness.
 *
 * This module replaces that dead end with an algorithmic approach:
 *
 *   1. Incremental summaries — every ~32K output tokens the model
 *      summarizes a focused, digestible segment.  Each summary is
 *      small enough to be reliable (operating well within the
 *      rate-distortion bound for its input size).
 *
 *   2. Algorithmic compaction — on overflow, prune from the latest
 *      summary boundary, inject a compacted-context message with
 *      precise DB record positions.  No LLM involved — deterministic.
 *
 *   3. Continuous memory — the model uses `session-read` with exact
 *      message IDs to pull precise details from any point in history.
 *      Like a database index: don't compress, just point.
 *
 * Edge case (old projects without summaries): trim to ~30K tokens
 * and produce a summary.  This happens at most once per session
 * lifetime — new sessions always have the summary chain.
 *
 * The invariant: compact is always a no-op or a precise DB prune.
 * Never "please summarize everything."
 */

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import * as Session from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { isOverflow as overflow } from "./overflow"
import { makeRuntime } from "@/effect/run-service"
import { fn } from "@/util/fn"

const log = Log.create({ service: "session.compaction" })

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
}

export const SUMMARY_INTERVAL_TOKENS = 32_768

function compactedMessage(summaryId: string | null, tailIds: string[], sessionId: string) {
  const summaryLine = summaryId
    ? `Summary: assistant \`${summaryId}\` covers the conversation up to that point.`
    : `No summary existed — kept ~30K tokens of recent context aligned to turn boundaries.`
  const tailLine = tailIds.length > 0
    ? `Active context: messages \`${tailIds[0]}\` through \`${tailIds[tailIds.length - 1]}\`.`
    : ""
  return `Your context has been compacted. Use \`session-read\` for precise history recall.

${summaryLine}
${tailLine}
Use \`messagesearch\` with query keywords to find pruned content by topic.
Use \`session-read\` with sessionId: "${sessionId}" and specific message IDs for exact retrieval.`
}

function summaryRequestMessage(fromId: string, toId: string) {
  return `Please create a structured summary of the conversation from message \`${fromId}\` to \`${toId}\`.

Include these message IDs in your summary:
- \`from_id\`: \`${fromId}\`
- \`to_id\`: \`${toId}\`

This lets \`session-read\` target the exact range you summarized.
Output ONLY the structured summary sections starting with ## Goal.`
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly compact: (input: {
    sessionID: SessionID
    model: { providerID: ProviderID; modelID: ModelID }
    agent: string
  }) => Effect.Effect<void>
  readonly injectSummaryRequest: (input: {
    sessionID: SessionID
    model: { providerID: ProviderID; modelID: ModelID }
    agent: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const layer: Layer.Layer<Service, never, Bus.Service | Config.Service | Session.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const cfg = yield* Config.Service
    const session = yield* Session.Service

    const isOverflow = (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        return overflow({ cfg: yield* config.get(), tokens: input.tokens, model: input.model })
      })

    const compact = (input: {
      sessionID: SessionID
      model: { providerID: ProviderID; modelID: ModelID }
      agent: string
    }) =>
      Effect.gen(function* () {
        const msgs: MessageV2.WithParts[] | undefined = yield* session
          .messages({ sessionID: input.sessionID })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
        if (!msgs?.length) return

        // Safety: if the most recent user message is already a compacted
        // notification (sequential compact calls before a new summary),
        // skip — nothing to prune, model hasn't had a chance to respond.
        let alreadyCompacted = false
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].info.role === "user") {
            alreadyCompacted = msgs[i].parts.some(
              (p: any) => p.type === "text" && p.text?.includes("context has been compacted"),
            )
            break
          }
        }
        if (alreadyCompacted) {
          log.info("compact skipped — already compacted, awaiting new summary", {
            sessionID: input.sessionID,
          })
          return
        }

        let lastSummaryIndex = -1
        let summaryAssistantId: string | null = null
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].info.role === "assistant" && msgs[i].info.summary) {
            summaryAssistantId = msgs[i].info.id
            // Keep from the user message that requested this summary,
            // so the summary request+response pair is preserved together.
            lastSummaryIndex = i > 0 && msgs[i - 1].info.role === "user" ? i - 1 : i
            break
          }
        }

        // With summaries: keep from the latest summary onward.
        // Each segment between summaries is naturally < 30K tokens,
        // so no additional trimming is needed.
        // Without summaries (old projects): trim to ~30K tokens.
        const hasSummary = lastSummaryIndex >= 0
        let keepFrom: number
        if (hasSummary) {
          keepFrom = lastSummaryIndex
        } else {
          const TARGET_TOKENS = 30_000
          const CHARS_PER_TOKEN = 4
          let accumulatedChars = 0
          keepFrom = 0
          for (let i = msgs.length - 1; i >= 0; i--) {
            for (const part of msgs[i].parts) {
              if (part.type === "text" && !(part as any).ignored) {
                accumulatedChars += (part as any).text?.length ?? 0
              }
            }
            if (msgs[i].info.role === "user") {
              if (accumulatedChars >= TARGET_TOKENS * CHARS_PER_TOKEN) {
                keepFrom = i
                break
              }
            }
          }
        }
        const toRemove = msgs.slice(0, keepFrom)

        if (toRemove.length > 0) {
          for (const msg of toRemove) {
            yield* session.removeMessage({ sessionID: input.sessionID, messageID: msg.info.id }).pipe(
              Effect.catchIf(NotFoundError.isInstance, () => Effect.void),
            )
          }
          log.info("compacted", { removed: toRemove.length, kept: msgs.length - toRemove.length })
        }

        // Collect tail message IDs (kept messages after the boundary)
        const kept = msgs.slice(keepFrom)
        const tailIds = kept
          .filter((m) => !m.info.summary) // exclude summary assistants from tail listing
          .map((m) => m.info.id)

        const msg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          model: input.model,
          sessionID: input.sessionID,
          agent: input.agent,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "text",
          text: compactedMessage(summaryAssistantId, tailIds, input.sessionID),
          synthetic: true,
        })

        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
      })

    const injectSummaryRequest = (input: {
      sessionID: SessionID
      model: { providerID: ProviderID; modelID: ModelID }
      agent: string
    }) =>
      Effect.gen(function* () {
        // Find the message range being summarized:
        // from = first message after last summary (or first message overall)
        // to = last message before this summary request
        const msgs: MessageV2.WithParts[] | undefined = yield* session
          .messages({ sessionID: input.sessionID })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))

        let fromId = "start"
        let toId = "end"
        if (msgs?.length) {
          // Find last summary boundary
          let lastSummaryIdx = -1
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].info.role === "assistant" && msgs[i].info.summary) {
              lastSummaryIdx = i
              break
            }
          }
          // from = first message after last summary (or first message)
          const fromIdx = lastSummaryIdx >= 0 ? lastSummaryIdx + 1 : 0
          fromId = msgs[fromIdx]?.info.id ?? "start"
          toId = msgs[msgs.length - 1]?.info.id ?? "end"
        }

        const msg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          model: input.model,
          sessionID: input.sessionID,
          agent: input.agent,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "text",
          text: summaryRequestMessage(fromId, toId),
          synthetic: true,
        })
        log.info("injected summary request", { sessionID: input.sessionID, fromId, toId })
      })

    return Service.of({
      isOverflow: isOverflow as any,
      compact: compact as any,
      injectSummaryRequest: injectSummaryRequest as any,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer)),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  return runPromise((svc) => svc.isOverflow(input))
}

export const compact = fn(
  z.object({
    sessionID: SessionID.zod,
    model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
    agent: z.string(),
  }),
  (input) => runPromise((svc) => svc.compact(input)),
)

export const injectSummaryRequest = fn(
  z.object({
    sessionID: SessionID.zod,
    model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
    agent: z.string(),
  }),
  (input) => runPromise((svc) => svc.injectSummaryRequest(input)),
)

export * as SessionCompaction from "./compaction"
