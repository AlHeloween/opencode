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
import { Effect, Layer, Context, Schema, Option } from "effect"
import { isOverflow as overflow } from "./overflow"
import { makeRuntime } from "@/effect/run-service"
import { fn } from "@/util/fn"
import { SessionStatus } from "./status"

const log = Log.create({ service: "session.compaction" })

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    Schema.Struct({ sessionID: SessionID }),
  ),
}

export const SUMMARY_INTERVAL_TOKENS = 32_768

function summaryRequestMessage(fromId: string, toId: string) {
  return `Please create a structured summary of the conversation from message \`${fromId}\` to \`${toId}\`.

Include these message IDs in your summary:
- \`from_id\`: \`${fromId}\`
- \`to_id\`: \`${toId}\`

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
    force?: boolean
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
    const session = yield* Session.Service
    // SessionStatus is optional — when not provided, lock check is skipped
    const statusOpt = yield* Effect.serviceOption(SessionStatus.Service)

    const CHARS_PER_TOKEN = 4

    /** Count chars from all content-bearing parts (text + reasoning + tool outputs). */
    const contentChars = (msgs: MessageV2.WithParts[]) => {
      let chars = 0
      for (const m of msgs) {
        for (const p of m.parts) {
          if (p.type === "text" && !(p as any).ignored) chars += (p as any).text?.length ?? 0
          else if (p.type === "reasoning") chars += (p as any).text?.length ?? 0
          else if (p.type === "tool" && p.state?.status === "completed") chars += (p.state as any).output?.length ?? 0
        }
      }
      return chars
    }

    const isOverflow = (input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) =>
      Effect.gen(function* () {
        const c = yield* Config.Service
        return overflow({ cfg: yield* c.get(), tokens: input.tokens, model: input.model })
      })

    /** Compact: collect summaries + recent messages into one message.
      * Mark old messages as compacted (soft-delete). The resulting message*
      * flows naturally — 30K summarizer fires on it if needed. */
    const compact = (input: {
      sessionID: SessionID
      model: { providerID: ProviderID; modelID: ModelID }
      agent: string
      force?: boolean
    }) =>
      Effect.gen(function* () {
        // Lock: guard against concurrent compaction calls via status state.
        // When SessionStatus is not available (e.g. in tests), skip the lock.
        if (Option.isSome(statusOpt)) {
          const currentStatus = yield* statusOpt.value.get(input.sessionID)
          if (currentStatus.type === "compacting") {
            log.debug("compaction skipped: already in progress", { sessionID: input.sessionID })
            return
          }
          yield* statusOpt.value.set(input.sessionID, { type: "compacting" })
        }

        const msgs = (yield* session.messages({ sessionID: input.sessionID }).pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
        )) as MessageV2.WithParts[] | undefined
        if (!msgs?.length) {
          if (Option.isSome(statusOpt)) yield* statusOpt.value.set(input.sessionID, { type: "idle" })
          return
        }

        // DB-grounded check: any message already marked compacted?
        // This is more reliable than scanning text for "=== COMPACTED ==="
        // because it catches partial compactions and doesn't depend on text content.
        const anyCompacted = msgs.some((m) => m.info.compacted === true)
        if (anyCompacted && !input.force) {
          log.debug("compaction skipped: already compacted", { sessionID: input.sessionID })
          if (Option.isSome(statusOpt)) yield* statusOpt.value.set(input.sessionID, { type: "idle" })
          return
        }

        // Collect all summaries
        const summaries: string[] = []
        let latestSummaryIdx = -1
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i]
          if (m.info.role === "assistant" && (m.info as any).summary) {
            const text = m.parts
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n")
            if (text) summaries.push(text)
            latestSummaryIdx = i
          }
        }

        // Take the tail after the latest summary (or last ~30K if no summary)
        const tailStart = latestSummaryIdx >= 0
          ? latestSummaryIdx + 1 // skip summary assistant, keep everything after
          : (() => {
              // Walk back to find ~30K token boundary
              let chars = 0
              for (let i = msgs.length - 1; i >= 0; i--) {
                chars += contentChars([msgs[i]])
                if (chars >= SUMMARY_INTERVAL_TOKENS * CHARS_PER_TOKEN) return i
              }
              return 0
            })()

        const tail = msgs.slice(tailStart)
        const tailText = tail
          .flatMap((m) => m.parts.filter((p: any) => p.type === "text").map((p: any) => p.text))
          .join("\n")

        // Build the compacted message*: summaries + tail content
        const combined = [
          "=== COMPACTED ===",
          ...summaries.map((s, i) => `--- Summary ${i + 1} ---\n${s}`),
          `--- Recent ---\n${tailText}`,
        ].join("\n\n")

        // Mark all messages before tailStart as compacted
        let compacted = 0
        const end = Math.min(tailStart, msgs.length)
        for (let i = 0; i < end; i++) {
          if (!msgs[i]) continue
          msgs[i].info.compacted = true
          yield* session.updateMessage(msgs[i].info)
          compacted++
        }

        // Inject message* as a new user message
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
          text: combined,
          synthetic: true,
        })

        log.info("compacted", { compacted, kept: msgs.length - compacted, summaries: summaries.length, forced: input.force ?? false })
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
      })

    /** Inject a summary request for the current message range. */
    const injectSummaryRequest = (input: {
      sessionID: SessionID
      model: { providerID: ProviderID; modelID: ModelID }
      agent: string
    }) =>
      Effect.gen(function* () {
        const msgs = (yield* session.messages({ sessionID: input.sessionID }).pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
        )) as MessageV2.WithParts[] | undefined

        let fromId = "start"
        let toId = "end"
        if (msgs?.length) {
          let lastSummaryIdx = -1
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].info.role === "assistant" && msgs[i].info.summary) { lastSummaryIdx = i; break }
          }
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
    force: z.boolean().optional(),
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
