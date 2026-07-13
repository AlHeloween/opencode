import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Session from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { registry } from "@/attachment/registry"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable, estimateContentTokens } from "./overflow"
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
  CompactionNotice: BusEvent.define(
    "session.compaction.notice",
    Schema.Struct({
      sessionID: SessionID,
      ratio: Schema.Number,
      tier: Schema.Literal("soft"),
    }),
  ),
  CompactionStuck: BusEvent.define(
    "session.compaction.stuck",
    Schema.Struct({
      sessionID: SessionID,
      consecutiveCompacts: Schema.Number,
    }),
  ),
  CompactionChunkProgress: BusEvent.define(
    "session.compaction.chunk_progress",
    Schema.Struct({
      sessionID: SessionID,
      chunk: Schema.Number,
      total: Schema.Number,
    }),
  ),
}

const MAX_CONSECUTIVE_COMPACTS = 3

/** Chunk head into multiple pieces when head tokens exceed this fraction of usable window. */
const CHUNK_THRESHOLD_RATIO = 0.7
/** Each chunk targets this fraction of the usable window (leaves room for instruction + output). */
const CHUNK_TARGET_RATIO = 0.5
/** Minimum characters a summary must contain to pass the quality guard. */
const MIN_SUMMARY_LENGTH = 200
/** Minimum `##` section headers required in a summary. */
const MIN_SECTIONS = 2

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_PRESERVE_RECENT_TOKENS = 10_000
const MIN_PRESERVE_RECENT_TOKENS = 2_000

type Turn = {
  start: number
  end: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: MessageV2.WithParts) {
  const text = message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function completedCompactions(messages: MessageV2.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function preserveRecentBudget(input: { cfg: Config.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(DEFAULT_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

/** Split head messages into chunks that each fit within the usable window.
  * Each chunk targets CHUNK_TARGET_RATIO * usable tokens and splits at turn boundaries. */
export function chunkHead(input: {
  head: MessageV2.WithParts[]
  cfg: Config.Info
  model: Provider.Model
}): MessageV2.WithParts[][] {
  // Only split if the head exceeds the chunk threshold
  const headTokens = estimateContentTokens(input.head, input.model)
  const available = usable(input)
  if (headTokens <= available * CHUNK_THRESHOLD_RATIO) {
    return [input.head]
  }

  // Walk through turns, splitting at CHUNK_TARGET boundaries
  const allTurns = turns(input.head)
  const target = available * CHUNK_TARGET_RATIO
  const chunks: MessageV2.WithParts[][] = []
  let currentStart = 0
  let currentTokens = 0

  for (const turn of allTurns) {
    const turnMsgs = input.head.slice(turn.start, turn.end)
    const turnTokens = estimateContentTokens(turnMsgs, input.model)

    // If adding this turn would exceed target and we have at least one turn
    if (currentTokens + turnTokens > target && currentStart < turn.start) {
      chunks.push(input.head.slice(currentStart, turn.start))
      currentStart = turn.start
      currentTokens = 0
    }
    currentTokens += turnTokens
  }

  // Collect remaining messages
  if (currentStart < input.head.length) {
    chunks.push(input.head.slice(currentStart))
  }

  // If chunking produced nothing useful, return the head as-is
  return chunks.length > 1 ? chunks : [input.head]
}

/** Extract searchable anchors (file paths, error strings, commands) from messages.
  * These help messagesearch find compacted content. */
export function extractAnchors(messages: MessageV2.WithParts[]): string[] {
  // Collect all text from message parts
  const fragments: string[] = []
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && !part.ignored) {
        fragments.push(part.text)
      } else if (part.type === "reasoning") {
        fragments.push(part.text)
      } else if (part.type === "tool" && part.state.status === "completed") {
        fragments.push(part.state.output)
      }
    }
  }
  const text = fragments.join("\n")

  const anchors = new Set<string>()

  // File paths: any path-like string with known extensions
  for (const match of text.matchAll(/\b(?:[\w-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|json|md|sql|css|html|cjs|mjs|rs|go|py|rb|java|swift|kt|ex|exs|pas|dpr|dproj)\b/gi)) {
    if (match[0].length > 5 && match[0].length < 200) anchors.add(match[0])
  }

  // Error strings: common error markers + their context
  for (const match of text.matchAll(/(?:Error|error|Cannot|Failed|Unable|TypeError|ReferenceError|SyntaxError|RangeError)[^\n]{0,80}/g)) {
    const trimmed = match[0].trim()
    if (trimmed.length > 5 && trimmed.length < 200) anchors.add(trimmed)
  }

  // Commands: tool invocations
  for (const match of text.matchAll(/\b(bun|npm|npx|git|cargo|python|node|docker|kubectl|drizzle|pnpm|yarn|deno|go|rustc|zig|make|cmake|mvn|gradle)\s+[^\n]{0,60}/gi)) {
    anchors.add(match[0].trim())
  }

  // Deduplicate, sort, and limit to reasonable size
  return [...anchors].sort().slice(0, 30)
}

/** Count `##` section headers in a summary.
  * Matches any level-2 markdown header to avoid fragility from
  * exact string matching (whitespace differences, sub-header-only sections). */
function countSections(summary: string): number {
  return (summary.match(/^##\s+/gm) ?? []).length
}

/** Strip any text before the first `## ` section header (thinking/reasoning preamble). */
export function stripReasoningPrefix(text: string): string {
  const sectionStart = text.indexOf("## ")
  if (sectionStart <= 0) return text
  return text.slice(sectionStart)
}

/** Validate that a compaction summary is substantive enough.
  * Returns { valid: true } or { valid: false, reason } for the quality guard. */
export function validateSummary(raw: string): { valid: true } | { valid: false, reason: string } {
  const summary = stripReasoningPrefix(raw)
  if (!summary || summary.trim().length < MIN_SUMMARY_LENGTH) {
    return { valid: false, reason: `too_short: ${summary.trim().length} chars < ${MIN_SUMMARY_LENGTH} required` }
  }

  // Check for at least MIN_SECTIONS level-2 markdown headers
  const sections = countSections(summary)
  if (sections < MIN_SECTIONS) {
    return { valid: false, reason: `missing_sections: found ${sections} sections, need at least ${MIN_SECTIONS}` }
  }

  return { valid: true }
}

function turns(messages: MessageV2.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderID; modelID: ModelID }
    auto: boolean
    overflow?: boolean
    forced?: boolean
    previousCheckpointIDs?: string[]
  }) => Effect.Effect<void>
  readonly selectMessages: (input: {
    messages: MessageV2.WithParts[]
    model: Provider.Model
  }) => Effect.Effect<{ head: MessageV2.WithParts[]; tail: MessageV2.WithParts[] }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Bus.Service
  | Config.Service
  | Session.Service
  | Agent.Service
  | Plugin.Service
  | Provider.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const provider = yield* Provider.Service

    // Per-session counter for consecutive compaction detection
    const compactionCounts = new Map<SessionID, number>()
    // Sessions where compaction hit the stuck threshold — auto-compaction
    // is suspended until a manual or forced compaction resets the state.
    const stuckSessions = new Set<SessionID>()

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({ cfg: yield* config.get(), tokens: input.tokens, model: input.model })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (_input: {
      messages: MessageV2.WithParts[]
      model: Provider.Model
    }) {
      // Use content-based token estimation (same as overflow detection)
      // instead of JSON serialization which inflates counts 3-5x
      return estimateContentTokens(_input.messages, _input.model)
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: MessageV2.WithParts[]
      cfg: Config.Info
      model: Provider.Model
      preserveLatest?: boolean
    }) {
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail: [] }
      if (input.preserveLatest === false) return { head: input.messages, tail: [] }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const latest = all.at(-1)!
      const latestSize = yield* estimate({
        messages: input.messages.slice(latest.start, latest.end),
        model: input.model,
      })

      if (latestSize > budget) log.info("latest tail exceeds preserve budget", { budget, total: latestSize })

      if (latest.start === 0) return { head: [], tail: input.messages }
      return {
        head: input.messages.slice(0, latest.start),
        tail: input.messages.slice(latest.start),
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      log.info("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: MessageV2.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      log.info("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        log.info("pruned", { count: toPrune.length })
      }
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
      /** Whether compaction was forced (bypassing economics). */
      forced?: boolean
      /** Message IDs from a previous checkpoint — used as compaction boundary.
       *  When provided, messages NOT in this set become the tail (delta). */
      previousCheckpointIDs?: string[]
    }) {
      // Stuck detection: track consecutive compactions per session.
      // If we compact on 3+ consecutive turns and context is still above
      // the full threshold, emit a stuck event and ADD the session to the
      // stuck set — auto-compaction is suspended until manual/forced reset.
      // Returning early would create an infinite loop in prompt.ts
      // (overflow check → create() → return → overflow check → ...),
      // so instead we skip creation but DO NOT suppress prompt.ts's
      // overflow check — it will loop back, see no compaction task, and
      // continue normally (the overflow check fires every turn, which is
      // fine since it just checks and continues without emitting events).
      if (input.auto && !input.forced) {
        if (stuckSessions.has(input.sessionID)) {
          log.warn("compaction stuck — auto-compaction suspended for session", {
            sessionID: input.sessionID,
          })
          // Stuck sessions suppress auto-compaction until manual reset.
          // The overflow check fires every turn harmlessly.
          compactionCounts.delete(input.sessionID)
          return
        }
        const prev = compactionCounts.get(input.sessionID) ?? 0
        compactionCounts.set(input.sessionID, prev + 1)
        if (prev + 1 >= MAX_CONSECUTIVE_COMPACTS) {
          log.warn("bug: compaction stuck — context window may be too small", {
            sessionID: input.sessionID,
            consecutiveCompacts: prev + 1,
          })
          yield* bus.publish(Event.CompactionStuck, {
            sessionID: input.sessionID,
            consecutiveCompacts: prev + 1,
          })
          // Mark session as stuck — prevents further auto-compaction
          stuckSessions.add(input.sessionID)
          compactionCounts.delete(input.sessionID)
          return
        }
      } else if (!input.auto) {
        // Manual or forced compaction resets the counter AND un-sticks
        stuckSessions.delete(input.sessionID)
        compactionCounts.delete(input.sessionID)
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
        text: `Please create a structured summary of the conversation history. Do not use any tools — just produce the summary.

Use this exact structure:

## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Commands & Outcomes
- [commands run (builds, tests, git) and their relevant results, or "(none)"]

## Errors & Fixes
- [problems encountered and how they were resolved, or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not answer the conversation. Do not mention that you are summarizing, compacting, or merging context.
- Output ONLY the structured summary sections starting with ## Goal. No thinking, no analysis, no meta-commentary, no greeting, no sign-off.
- Start directly with ## Goal. Never prefix anything before it.`,
        synthetic: true,
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        ...(input.previousCheckpointIDs?.length ? { previousCheckpointIDs: input.previousCheckpointIDs } : {}),
      })
    })

    return Service.of({
      isOverflow,
      prune,
      create,
      selectMessages: Effect.fn("SessionCompaction.selectMessages")(function* (input: {
        messages: MessageV2.WithParts[]
        model: Provider.Model
      }) {
        const cfg = yield* config.get()
        return yield* select({ ...input, cfg })
      }),
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
  ),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  return runPromise((svc) => svc.isOverflow(input))
}

export async function prune(input: { sessionID: SessionID }) {
  return runPromise((svc) => svc.prune(input))
}

export const create = fn(
  z.object({
    sessionID: SessionID.zod,
    agent: z.string(),
    model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
    auto: z.boolean(),
    overflow: z.boolean().optional(),
    previousCheckpointIDs: z.array(z.string()).optional(),
  }),
  (input) => runPromise((svc) => svc.create(input)),
)

export * as SessionCompaction from "./compaction"
