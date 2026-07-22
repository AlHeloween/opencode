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

/** ~30K output tokens between incremental summary requests. */
export const SUMMARY_INTERVAL_TOKENS = 32_768

const CHARS_PER_TOKEN = 4
const SUMMARY_INTERVAL_CHARS = SUMMARY_INTERVAL_TOKENS * CHARS_PER_TOKEN

function isMessageStar(msg: MessageV2.WithParts): boolean {
  return msg.parts.some(
    (p) => p.type === "text" && typeof (p as any).text === "string" && (p as any).text.includes("=== COMPACTED ==="),
  )
}

/** Extract content from all content-bearing parts (text + reasoning + tool outputs).
  * Must stay consistent with {@link contentChars} so the model sees everything
  * that was counted toward the ~30K interval threshold. */
function messageText(msg: MessageV2.WithParts): string {
  const parts: string[] = []
  for (const p of msg.parts) {
    if (p.type === "text" && !(p as any).ignored) {
      parts.push((p as any).text ?? "")
    } else if (p.type === "reasoning") {
      parts.push(`[reasoning]\n${(p as any).text ?? ""}`)
    } else if (p.type === "tool" && (p as any).state?.status === "completed") {
      const label = `[tool:${(p as any).tool}]`
      const output = (p as any).state?.output ?? ""
      parts.push(`${label}\n${output}`)
    }
  }
  return parts.join("\n")
}

/** Count chars from content-bearing parts (text + reasoning + tool outputs). */
function contentChars(msgs: MessageV2.WithParts[]): number {
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

/** Walk back from the end until ~30K tokens of content; return start index. */
function trimToLastInterval(msgs: MessageV2.WithParts[]): number {
  let chars = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    chars += contentChars([msgs[i]])
    if (chars >= SUMMARY_INTERVAL_CHARS) return i
  }
  return 0
}

/** Walk backward through msgs from the end, summing output tokens of assistants
  * until a summary assistant is found. Returns the total output tokens since
  * the last summary (or since session start if no summary exists).
  *
  * Survives `runLoop` restarts — reads from persisted message tokens rather
  * than relying on the in-memory `outputTokensSinceLastSummary` counter that
  * was previously reset on every user message. */
export function computeOutputSinceLastSummary(msgs: MessageV2.WithParts[]): number {
  let tokens = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.info.role === "assistant" && (m.info as any).summary) break
    if (m.info.role === "assistant") {
      tokens += (m.info as any).tokens?.output ?? 0
      tokens += (m.info as any).tokens?.reasoning ?? 0
    }
  }
  return tokens
}

function summaryRequestMessage(fromId: string, toId: string, sessionID: string, lastSv?: SemanticVector) {
  const svHint = lastSv?.dominant
    ? `\nYour previous semantic vector was: "${lastSv.dominant}".\nLink to it by using a related dominant or referencing its key phrases.\n`
    : ""
  return `<!-- summary-range from_id="${fromId}" to_id="${toId}" session_id="${sessionID}" -->
Create a structured summary of the conversation.${svHint}
Epistemic rank (info_mark): **Inferred** (not Exact).  Use session-read with message IDs
from the compaction header to recover Exact detail.

Output ONLY these sections — no preamble, no IDs, no links:

## Semantic Vector
(Your intent understanding as key phrases with weights, Σ=1.0, 3-5 phrases.
This is your normalized embedding of intent — without it, the system cannot
track what you were actually trying to do across compaction cycles.
If you skip this section, your summary becomes a black box — retrievable
but not semantically linkable to prior work.)
Format:
  dominant: "<3-5 word phrase capturing the core intent>"
  key_phrases:
    - phrase: "<key phrase>"
      weight: <0.0-1.0>
    - phrase: "<key phrase>"
      weight: <0.0-1.0>

## Goal
(What the user was trying to accomplish.)

## Key decisions
(Explicit decisions: files created, approaches chosen, tradeoffs accepted.
Each on a separate "-" line.  Include file paths and rationale.
This section is preserved verbatim across compaction cycles.)

## Current state
(What completed, in progress, remaining.)`
}

/** Parsed semantic vector from a summary's ## Semantic Vector section. */
interface SemanticVector {
  dominant?: string
  keyPhrases: { phrase: string; weight: number }[]
}

/** Extract ## Semantic Vector from summary text. */
function extractSemanticVector(text: string): SemanticVector | undefined {
  const match = text.match(/## Semantic Vector\s*\n([\s\S]*?)(?=\n## |\n--- |$)/i)
  if (!match?.[1]) return undefined
  const block = match[1]
  // dominant: "..." or dominant: '...' (both quote styles)
  const dominantMatch = block.match(/dominant:\s*["']([^"']+)["']/)
  const phrases: { phrase: string; weight: number }[] = []
  // - phrase: "..." / '...' with weight on next line
  const phraseRe = /-\s*phrase:\s*["']([^"']+)["']\s*\n\s*weight:\s*([\d.]+)/g
  let pm
  while ((pm = phraseRe.exec(block)) !== null) {
    phrases.push({ phrase: pm[1], weight: parseFloat(pm[2]) })
  }
  if (!dominantMatch && phrases.length === 0) return undefined
  return { dominant: dominantMatch?.[1], keyPhrases: phrases }
}

/** Extract ## Key decisions blocks from summary or messageStar text.
  * Returns each decision line (trimmed, non-empty, starting with "-").
  * Used to preserve decisions verbatim across compaction cycles. */
function extractDecisions(text: string): string[] {
  // Match ## Key decisions section — capture everything until the next ## heading or end
  const match = text.match(/## Key decisions\s*\n([\s\S]*?)(?=\n## |\n--- |$)/i)
  if (!match?.[1]) return []
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
}

function buildMessageStar(input: {
  sessionID: string
  summaries: { id: string; text: string; fromId?: string; toId?: string }[]
  recent: MessageV2.WithParts[]
  /** Decisions preserved from prior compaction cycles (verbatim). */
  priorDecisions?: string[]
}): string {
  const summaryBlocks = input.summaries.map((s, i) => {
    const sv = extractSemanticVector(s.text)
    const svLine = sv?.dominant ? `- sv_dominant: \`${sv.dominant}\`` : undefined
    const links = [
      `- info_mark: \`Inferred\``,
      `- summary_message_id: \`${s.id}\``,
      svLine,
      s.fromId ? `- from_id: \`${s.fromId}\`` : undefined,
      s.toId ? `- to_id: \`${s.toId}\`` : undefined,
      `- session_id: \`${input.sessionID}\``,
    ]
      .filter(Boolean)
      .join("\n")
    return `--- Summary ${i + 1} ---\n${links}\n\n${s.text}`
  })

  // Collect decisions from current summaries + preserved prior decisions
  const currentDecisions = input.summaries.flatMap((s) => extractDecisions(s.text))
  const allDecisions = [...(input.priorDecisions ?? []), ...currentDecisions]
  const decisionsBlock =
    allDecisions.length > 0
      ? [
          "--- Decisions (preserved verbatim across compaction cycles) ---",
          `info_mark: Inferred — not re-summarized; preserved from original summary.`,
          `session_id: \`${input.sessionID}\``,
          "",
          ...allDecisions.map((d) => `- ${d.replace(/^- /, "")}`),
        ].join("\n")
      : undefined

  // Last semantic vector for continuity
  const lastSummary = input.summaries[input.summaries.length - 1]
  const lastSv = lastSummary ? extractSemanticVector(lastSummary.text) : undefined
  const lastSvLine = lastSv?.dominant
    ? `\nLast semantic vector: \`${lastSv.dominant}\` — link your next summary to this.`
    : ""

  const recentIds = input.recent.map((m) => m.info.id)
  const recentBlocks = input.recent.map((m) => {
    const body = messageText(m)
    return body ? `[${m.info.role} \`${m.info.id}\` info_mark=Mixed]\n${body}` : `[${m.info.role} \`${m.info.id}\` info_mark=Mixed]`
  })

  const recentHeader =
    recentIds.length > 0
      ? `--- Recent (${recentIds.length} messages: \`${recentIds[0]}\` .. \`${recentIds[recentIds.length - 1]}\`) ---\n` +
        `session_id: \`${input.sessionID}\`\n` +
        `info_mark: Mixed — treat as working context; use session-read for Exact.\n` +
        `Use session-read with these IDs for Exact detail. Use messagesearch for topics.\n\n` +
        recentBlocks.join("\n\n")
      : `--- Recent ---\n(none — all history is covered by summaries above)\nsession_id: \`${input.sessionID}\`\ninfo_mark: Inferred`

  return [
    "=== COMPACTED ===",
    "Active memory for this session. Older messages remain in the DB (not deleted).",
    "Epistemic ranks: summaries = Inferred; session-read(id) = Exact; unaided recall = Guess.",
    `Recover Exact detail with session-read (message IDs below) or messagesearch (keywords).${lastSvLine}`,
    "",
    ...summaryBlocks,
    decisionsBlock,
    recentHeader,
  ]
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n\n")
}

/** Extract summary range from a summary-request user message.
  * The range is embedded in an HTML comment — invisible to the model,
  * parsed by compact() to stamp links on the message* block. */
function extractRangeFromRequest(text: string): { fromId?: string; toId?: string } {
  const match = text.match(/<!--\s*summary-range\s+from_id="([^"]+)"\s+to_id="([^"]+)"/)
  if (!match) return {}
  return { fromId: match[1], toId: match[2] }
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

    const isOverflow = (input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) =>
      Effect.gen(function* () {
        const c = yield* Config.Service
        return overflow({ cfg: yield* c.get(), tokens: input.tokens, model: input.model })
      })

    /**
     * Mechanistic compaction:
     *   (m,m,m,s,m,m,s,m,m,m) → message* = (s,s, recent m…)
     *
     * - Never deletes messages (soft-hide via info.compacted).
     * - message* is the only visible memory afterward; growth continues as
     *   (m*, s, m, m, …) and compact runs again when overflowed.
     * - Summaries always carry session-read message ID links.
     */
    const compact = (input: {
      sessionID: SessionID
      model: { providerID: ProviderID; modelID: ModelID }
      agent: string
      force?: boolean
    }) =>
      Effect.gen(function* () {
        if (Option.isSome(statusOpt)) {
          const currentStatus = yield* statusOpt.value.get(input.sessionID)
          if (currentStatus.type === "compacting") {
            log.debug("compaction skipped: already in progress", { sessionID: input.sessionID })
            return
          }
          yield* statusOpt.value.set(input.sessionID, { type: "compacting" })
        }

        const finish = (next: "idle" | "busy" = "idle") =>
          Option.isSome(statusOpt)
            ? statusOpt.value.set(input.sessionID, { type: next })
            : Effect.void

        const msgs = (yield* session.messages({ sessionID: input.sessionID }).pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
        )) as MessageV2.WithParts[] | undefined
        if (!msgs?.length) {
          yield* finish()
          return
        }

        const visible = msgs.filter((m) => !m.info.compacted)
        if (!visible.length) {
          yield* finish()
          return
        }

        // Idempotent: only a single prior message* and nothing new to fold.
        if (!input.force && visible.length === 1 && isMessageStar(visible[0])) {
          log.debug("compaction skipped: already message* only", { sessionID: input.sessionID })
          yield* finish()
          return
        }

        // All summary assistants from full DB (including soft-hidden) — never lost.
        // Range (fromId/toId) is extracted from the summary-request user message
        // immediately preceding each summary assistant — system-managed, not echoed by model.
        const summaries: { id: string; text: string; fromId?: string; toId?: string }[] = []
        let latestSummaryIdx = -1
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i]
          if (m.info.role === "assistant" && (m.info as any).summary) {
            const text = messageText(m)
            if (text) {
              const prev = i > 0 ? msgs[i - 1] : undefined
              const range = prev?.info.role === "user" && prev.parts.some((p) => p.type === "text" && (p as any).synthetic)
                ? extractRangeFromRequest(
                    (prev.parts.find((p) => p.type === "text" && (p as any).text?.includes("summary-range")) as any)?.text ?? ""
                  )
                : {}
              summaries.push({ id: m.info.id, text, ...range })
            }
            if (!extractSemanticVector(text)) {
              log.debug("summary missing semantic vector", { id: m.info.id })
            }
            latestSummaryIdx = i
          }
        }

        const latestSummaryId = latestSummaryIdx >= 0 ? msgs[latestSummaryIdx].info.id : undefined

        // Recent = visible messages after the latest summary, excluding prior message*.
        // Prior message* is redundant: its summaries are re-collected from DB above.
        let recent = visible.filter((m) => {
          if (isMessageStar(m)) return false
          if (!latestSummaryId) return true
          return m.info.id > latestSummaryId
        })

        // No summary yet: if past exceeds ~30K, keep only the last interval in message*.
        if (!summaries.length && contentChars(recent) >= SUMMARY_INTERVAL_CHARS) {
          const start = trimToLastInterval(recent)
          recent = recent.slice(start)
        }

        // Collect decisions from the prior messageStar (if any) so they survive
        // across compaction cycles verbatim — "Inferred once, not re-Inferred."
        const priorMsgStar = visible.find((m) => isMessageStar(m))
        const priorDecisions = priorMsgStar
          ? extractDecisions(messageText(priorMsgStar))
          : undefined

        const combined = buildMessageStar({
          sessionID: input.sessionID,
          summaries,
          recent,
          priorDecisions,
        })

        // Soft-hide every currently visible message (DB retained for session-read).
        let compacted = 0
        for (const m of visible) {
          m.info.compacted = true
          yield* session.updateMessage(m.info)
          compacted++
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
          text: combined,
          synthetic: true,
        })

        log.info("compacted", {
          compacted,
          summaries: summaries.length,
          recent: recent.length,
          forced: input.force ?? false,
        })
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        yield* finish()
      }).pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            if (Option.isSome(statusOpt)) {
              yield* statusOpt.value.set(input.sessionID, { type: "idle" })
            }
            return yield* Effect.fail(err)
          }),
        ),
      )

    /**
     * Layer 1: inject a summary request for the next ~30K window.
     * Range starts after the latest summary (or start of visible history).
     * If the open range exceeds ~30K tokens, trim from_id to the last 30K.
     */
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
          const visible = msgs.filter((m) => !m.info.compacted)
          const pool = visible.length ? visible : msgs

          let lastSummaryIdx = -1
          for (let i = pool.length - 1; i >= 0; i--) {
            if (pool[i].info.role === "assistant" && pool[i].info.summary) {
              lastSummaryIdx = i
              break
            }
          }

          let range = pool.slice(lastSummaryIdx >= 0 ? lastSummaryIdx + 1 : 0)
          // Trim to last ~30K if the open segment is larger than one summary interval.
          if (contentChars(range) >= SUMMARY_INTERVAL_CHARS) {
            range = range.slice(trimToLastInterval(range))
          }

          fromId = range[0]?.info.id ?? pool[0]?.info.id ?? "start"
          toId = range[range.length - 1]?.info.id ?? pool[pool.length - 1]?.info.id ?? "end"
        }

        // Find the last summary's semantic vector so the model can link to it
        let lastSv: SemanticVector | undefined
        if (msgs?.length) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].info.role === "assistant" && (msgs[i].info as any).summary) {
              const sv = extractSemanticVector(messageText(msgs[i]))
              if (sv) { lastSv = sv; break }
            }
          }
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
          text: summaryRequestMessage(fromId, toId, input.sessionID, lastSv),
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
