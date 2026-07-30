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
import { IncrementalCheckpoint } from "./incremental-checkpoint"
import { parseSummaryRange } from "./summary"
import { Snapshot } from "@/snapshot"

const log = Log.create({ service: "session.compaction" })

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    Schema.Struct({ sessionID: SessionID }),
  ),
}

/** Normal Layer-1 cadence: ~64K content-token estimates between summaries. */
export const SUMMARY_INTERVAL_TOKENS = 65_536
export const MAX_SUMMARY_ATTEMPTS = 2

const CHARS_PER_TOKEN = 4
const SUMMARY_TERMINAL_MARKER = "<!-- summary-terminal -->"

/** True only for the synthetic message* body produced by compact().
  * Must NOT match COMPACTION_REMINDER text that merely *mentions* the marker
  * (that reminder is injected onto every post-compact user message — matching
  * it would exclude all real user messages from the next message* Recent fold). */
function isMessageStar(msg: MessageV2.WithParts): boolean {
  return msg.parts.some(
    (p) =>
      p.type === "text" &&
      typeof (p as { text?: string }).text === "string" &&
      (p as { text: string }).text.trimStart().startsWith("=== COMPACTED ==="),
  )
}

/** Extract content from ALL part types — faithful rendering for the messageStar.
  * The messageStar is a SYSTEM artifact, not an AI interpretation. Every part type
  * that exists in the DB must have a rendering path here so the model can trace
  * the full turn sequence (user → assistant-text → assistant-reasoning → tool → ...).
  *
 * Must stay consistent with {@link contentChars} so the model sees everything
 * that was counted toward the Layer-1 interval threshold. */
function messageText(msg: MessageV2.WithParts): string {
  const parts: string[] = []
  for (const p of msg.parts) {
    switch (p.type) {
      case "text":
        // Render ALL text parts regardless of `ignored` flag.
        // User text parts are marked ignored:true by prompt.ts wrapping —
        // dropping them causes the model to lose the user's actual words.
        parts.push(`[text]\n${(p as any).text ?? ""}`)
        break
      case "reasoning":
        parts.push(`[reasoning]\n${(p as any).text ?? ""}`)
        break
      case "tool": {
        const label = `[tool:${(p as any).tool}]`
        const status = (p as any).state?.status ?? "unknown"
        const output = (p as any).state?.output ?? ""
        parts.push(`${label} (${status})\n${output}`)
        break
      }
      case "subtask":
        parts.push(
          `[subtask:${(p as any).agent}]\n${(p as any).prompt ?? (p as any).description ?? ""}`,
        )
        break
      case "file":
        parts.push(`[file: ${(p as any).filename ?? "unknown"} (${(p as any).mediaType ?? (p as any).mime ?? "?"})]`)
        break
      case "step-start":
        parts.push(`[step-start]`)
        break
      case "step-finish":
        parts.push(`[step-finish]`)
        break
      case "snapshot":
        parts.push(`[snapshot: ${(p as any).hash ?? "?"}]`)
        break
      case "patch":
        parts.push(`[patch]\n${((p as any).content ?? "").slice(0, 500)}`)
        break
      case "agent":
        parts.push(`[agent: ${(p as any).agent ?? "?"}]`)
        break
      case "retry":
        parts.push(`[retry attempt=${(p as any).attempt ?? "?"}]`)
        break
      case "compaction":
        // intentional skip — internal compaction markers
        break
    }
  }
  return parts.join("\n")
}

/** Count chars from content-bearing parts (text + reasoning + tool outputs). */
function contentChars(msgs: MessageV2.WithParts[]): number {
  let chars = 0
  for (const m of msgs) {
    for (const p of m.parts) {
      // Count ALL text parts (including ignored) — consistent with messageText()
      if (p.type === "text") chars += (p as any).text?.length ?? 0
      else if (p.type === "reasoning") chars += (p as any).text?.length ?? 0
      else if (p.type === "tool") chars += (p.state as any)?.output?.length ?? 0
      else if (p.type === "subtask") chars += ((p as any).prompt?.length ?? 0) + ((p as any).description?.length ?? 0)
      else if (p.type === "patch") chars += ((p as any).content?.length ?? 0)
      // step-start, step-finish, snapshot, agent, retry, file, compaction — negligible, skip for perf
    }
  }
  return chars
}

/** Walk back from the end until the supplied content-token interval; return start index. */
function trimToLastInterval(msgs: MessageV2.WithParts[], intervalTokens = SUMMARY_INTERVAL_TOKENS): number {
  let chars = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    chars += contentChars([msgs[i]])
    if (chars >= intervalTokens * CHARS_PER_TOKEN) return i
  }
  return 0
}

/** Walk backward through msgs from the end, summing output tokens of assistants
  * until a summary assistant is found. Returns the total output tokens since
  * the last summary (or since session start if no summary exists).
  *
  * Survives `runLoop` restarts — reads from persisted message tokens rather
  * than relying on the in-memory `outputTokensSinceLastSummary` counter that
  * was previously reset on every user message.
  *
  * Prefer {@link computeOpenWindowTokens} for Layer-1 injection — that matches
  * message* sizing (chars/4) and the content window the model actually sees. */
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

/** True for the synthetic Layer-1 summary-request user message. */
export function isSummaryRequestMessage(msg: MessageV2.WithParts): boolean {
  return msg.parts.some(
    (p) =>
      p.type === "text" &&
      typeof (p as { text?: string }).text === "string" &&
      (p as { text: string }).text.includes("<!-- summary-range"),
  )
}

/** A bounded summary attempt that exhausted its retries. It is not pending. */
export function isTerminalSummaryRequestMessage(msg: MessageV2.WithParts): boolean {
  return msg.parts.some(
    (p) =>
      p.type === "text" &&
      typeof (p as { text?: string }).text === "string" &&
      (p as { text: string }).text.includes(SUMMARY_TERMINAL_MARKER),
  )
}

/** Persisted marker keeps a failed range from hijacking a later real user turn. */
export function summaryTerminalMarker() {
  return SUMMARY_TERMINAL_MARKER
}

/** Attempts are assistant rows attached to one synthetic summary-request user row. */
export function summaryAttemptCount(msgs: MessageV2.WithParts[], requestID: MessageID): number {
  return msgs.filter((m) => m.info.role === "assistant" && m.info.parentID === requestID).length
}

/**
 * Layer-1 summary **token counter**: content tokens (chars/4) of the open window
 * since the last summary assistant, or of the entire visible list when none.
 *
 * After compact there is no summary after the new message*, so this returns
 * ~len(message*)/4 (+ any newer msgs). That *is* the counter baseline — not a
 * special “if message* > interval” rule. The caller supplies the effective
 * provider-safe threshold, with SUMMARY_INTERVAL_TOKENS as the normal target.
 *
 * - Real context (text + reasoning + tool output), not provider usage
 * - Survives runLoop restarts (pure function of persisted messages)
 */
export function computeOpenWindowTokens(msgs: MessageV2.WithParts[], checkpointBoundaryID?: string): number {
  let start = 0
  // Sidecar checkpoints are the canonical Layer-1 boundary; the legacy
  // assistant.summary flag is no longer written in the sidecar path.
  if (checkpointBoundaryID) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].info.id === checkpointBoundaryID) {
        start = i + 1
        break
      }
    }
  }
  return Math.ceil(contentChars(msgs.slice(start)) / CHARS_PER_TOKEN)
}

/**
 * True when a summary-range user message is still waiting for its summary
 * assistant. Survives runLoop restarts (unlike in-memory pending flags).
 */
export function hasPendingSummaryRequest(msgs: MessageV2.WithParts[]): boolean {
  const request = msgs.findLast((m) => m.info.role === "user")
  if (!request || !isSummaryRequestMessage(request)) return false
  if (isTerminalSummaryRequestMessage(request)) return false
  return !msgs.some((m) => m.info.role === "assistant" && m.info.parentID === request.info.id && m.info.summary)
}

/** Required Layer-1 sections; an arbitrary 40-character reply is not a handle. */
export function isValidSummaryBody(text: string): boolean {
  return ["Semantic Vector", "Goal", "Key decisions", "Current state"].every((heading) => {
    const section = text.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "im"))
    return !!section?.[1]?.trim()
  })
}

/**
 * True when an assistant turn is fully complete and safe for synthetic injects
 * (Layer-1 summary-range, resume, etc.).
 *
 * Reasoning models (and several providers) reject or corrupt mid-stream / mid-turn
 * user inserts while thinking or tool-calls are still open. Inject only after:
 * - finish is set and not tool-calls/unknown
 * - every reasoning part has time.end (stream closed)
 */
export function isAssistantTurnComplete(msg: MessageV2.WithParts | undefined): boolean {
  if (!msg || msg.info.role !== "assistant") return false
  const finish = (msg.info as MessageV2.Assistant).finish
  if (!finish || finish === "tool-calls" || finish === "unknown") return false
  for (const p of msg.parts) {
    if (p.type !== "reasoning") continue
    const end = (p as { time?: { end?: number } }).time?.end
    if (end == null) return false
  }
  return true
}

/** Parsed semantic vector from a summary's ## Semantic Vector section.
  * Sparse phrase embedding: key_phrases with weights (Σ=1.0), plus dominant. */
interface SemanticVector {
  dominant?: string
  keyPhrases: { phrase: string; weight: number }[]
}

/** Extract ## Semantic Vector from summary text (both quote styles). */
function extractSemanticVector(text: string): SemanticVector | undefined {
  const match = text.match(/## Semantic Vector\s*\n([\s\S]*?)(?=\n## |\n--- |$)/i)
  if (!match?.[1]) return undefined
  const block = match[1]
  // dominant: "..." or dominant: '...'
  const dominantMatch = block.match(/dominant:\s*["']([^"']+)["']/)
  const phrases: { phrase: string; weight: number }[] = []
  // - phrase: "..." / '...' with weight on next line
  const phraseRe = /-\s*phrase:\s*["']([^"']+)["']\s*\n\s*weight:\s*([\d.]+)/g
  let pm: RegExpExecArray | null
  while ((pm = phraseRe.exec(block)) !== null) {
    phrases.push({ phrase: pm[1], weight: parseFloat(pm[2]) })
  }
  if (!dominantMatch && phrases.length === 0) return undefined
  return { dominant: dominantMatch?.[1], keyPhrases: phrases }
}

/** SYSTEM-only range marker (stored as ignored text part — not sent to the model). */
export function summaryRangeSystemMarker(fromId: string, toId: string, sessionID: string) {
  return `<!-- summary-range from_id="${fromId}" to_id="${toId}" session_id="${sessionID}" -->`
}

/**
 * Model-facing Layer-1 request: Inferred prose only (SVM, goal, decisions, state).
 * No digital facts — no IDs, diffs, hashes, codegraph. Those are system/fossil/CG.
 */
export function summaryRequestProse(lastSv?: SemanticVector) {
  const svHint = lastSv?.dominant
    ? `\nPrior window dominant (chain continuity only): "${lastSv.dominant}". Prefer a related dominant and/or overlapping key phrases.\n`
    : ""
  return `Create a structured summary of the recent conversation window.${svHint}
Write **Inferred** narrative only: Semantic Vector, goal, key decisions, current state.
Do **not** invent or list message IDs, session IDs, database positions, file diffs, hashes, or codegraph data.

## Semantic Vector
(Sparse normalized embedding: key phrases with weights, Σ=1.0, 3-5 phrases.)
Format:
  dominant: "<3-5 word phrase capturing the core intent>"
  key_phrases:
    - phrase: "<key phrase>"
      weight: <0.0-1.0>
    - phrase: "<key phrase>"
      weight: <0.0-1.0>

## Goal
(What the user was trying to accomplish in this window.)

## Key decisions
(Explicit decisions: approaches chosen, design tradeoffs.
Each decision on a separate line starting with "-". Specific and actionable —
this section is preserved verbatim across compaction cycles.)

## Current state
(What was completed, what is in progress, what remains.)`
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
  summaries: {
    id: string
    text: string
    fromId?: string
    toId?: string
    diffs?: Snapshot.FileDiff[]
    impact?: Snapshot.ImpactSummary
    sidecar?: boolean
  }[]
  recent: MessageV2.WithParts[]
  /** 1-based global offset of the first recent message in the session.
    * Used to render `#N` positions so the model can call session-read
    * with an exact offset directly, without messagesearch indirection. */
  recentStartOffset?: number
  /** Decisions preserved from prior compaction cycles (verbatim). */
  priorDecisions?: string[]
  /** Prior messageStar ID — chain link for recovering older summaries via session-read. */
  priorMessageStarId?: string
}): string {
  const summaryBlocks = input.summaries.map((s, i) => {
    const sv = extractSemanticVector(s.text)
    const svLine = sv?.dominant ? `- sv_dominant: \`${sv.dominant}\`` : undefined
    const diffLine =
      s.diffs && s.diffs.length > 0
        ? [
            `- tool_diff: system Exact (write/edit/multiedit filediff from session DB)`,
            `  files=${s.diffs.length}; additions=${s.diffs.reduce((sum, diff) => sum + diff.additions, 0)}; deletions=${s.diffs.reduce((sum, diff) => sum + diff.deletions, 0)}`,
            ...s.diffs.slice(0, 20).flatMap((diff) => {
              const head = `  - ${diff.file} (+${diff.additions}/-${diff.deletions} ${diff.status ?? "modified"})`
              // Bounded unified snippet for agent recovery — not empty stats-only.
              if (!diff.patch?.trim()) return [head]
              const lines = diff.patch.trim().split("\n").slice(0, 40)
              const more = diff.patch.split("\n").length > 40 ? "\n    …" : ""
              return [head, "    ```diff", ...lines.map((l) => `    ${l}`), `    \`\`\`${more}`]
            }),
            ...(s.diffs.length > 20
              ? [`  - … +${s.diffs.length - 20} more; sessionread this summary range for the full Exact list`]
              : []),
          ].join("\n")
        : undefined
    const impactLine = s.impact
      ? [
          `- structural_impact: system index-time Structural`,
          `  changed_files=${s.impact.changedFiles}; caller_count=${s.impact.callerCount}`,
          `  kinds=${Object.entries(s.impact.symbolCountByKind).map(([kind, count]) => `${kind}:${count}`).join(",") || "none"}`,
          `  top_symbols=${s.impact.topSymbols.slice(0, 20).join(",") || "none"}`,
          `  impacted_files=${s.impact.impactedFiles.slice(0, 20).join(",") || "none"}`,
        ].join("\n")
      : undefined
    // Links below are SYSTEM Exact digits — not model-authored.
    const links = [
      `- links: system Exact (not model output)`,
      `- body_info_mark: \`Inferred\``,
      `- ${s.sidecar ? "checkpoint_id" : "summary_message_id"}: \`${s.id}\``,
      svLine,
      diffLine,
      impactLine,
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

  // Last SV in this window — continuity hint for the next summary cycle
  const lastSummary = input.summaries[input.summaries.length - 1]
  const lastSv = lastSummary ? extractSemanticVector(lastSummary.text) : undefined
  const lastSvLine = lastSv?.dominant
    ? `\nLast semantic vector: \`${lastSv.dominant}\` — link your next summary to this.`
    : ""

  const recentIds = input.recent.map((m) => m.info.id)
  const recentBlocks = input.recent.map((m, i) => {
    const offset = input.recentStartOffset != null ? input.recentStartOffset + i : undefined
    const offsetTag = offset != null ? ` #${offset}` : ""
    const body = messageText(m)
    return body
      ? `[${m.info.role} \`${m.info.id}\`${offsetTag} info_mark=Mixed]\n${body}`
      : `[${m.info.role} \`${m.info.id}\`${offsetTag} info_mark=Mixed]`
  })

  const recentHeader =
    recentIds.length > 0
      ? `--- Recent (${recentIds.length} messages: \`${recentIds[0]}\` .. \`${recentIds[recentIds.length - 1]}\`) ---\n` +
        `session_id: \`${input.sessionID}\`\n` +
        `info_mark: Mixed — working context (Inferred unless re-read).\n\n` +
        recentBlocks.join("\n\n")
      : `--- Recent ---\n(none — all history is covered by summaries above)\nsession_id: \`${input.sessionID}\`\ninfo_mark: Inferred`

  // Passive links + ranks only. No "Fast recovery / use these tools" recipes —
  // those pushed models into session-read/db-read spirals instead of work.
  return [
    "=== COMPACTED ===",
    "Active memory for this session. Older messages remain soft-hidden in the DB (not deleted).",
    "InfoMark: summary bodies = Inferred; system ID lines below = Exact handles; unaided recall = Guess.",
    "Continue the task from this memory. Re-read archive only when a specific fact is missing.",
    ...(input.priorMessageStarId
      ? [`Prior message*: \`${input.priorMessageStarId}\``]
      : []),
    lastSvLine,
    "",
    ...summaryBlocks,
    decisionsBlock,
    recentHeader,
  ]
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n\n")
}

/** Best-effort extract from_id/to_id links embedded in a prior summary text. */
function extractSummaryLinks(text: string): { fromId?: string; toId?: string } {
  const from = text.match(/from_id[`:\s]*`?([a-zA-Z0-9_-]+)`?/i)
  const to = text.match(/to_id[`:\s]*`?([a-zA-Z0-9_-]+)`?/i)
  return {
    fromId: from?.[1],
    toId: to?.[1],
  }
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
    threshold?: number
  }) => Effect.Effect<{ messageStarTokens: number }>
  readonly injectSummaryRequest: (input: {
    sessionID: SessionID
    model: { providerID: ProviderID; modelID: ModelID }
    agent: string
    threshold?: number
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
      threshold?: number
    }) =>
      Effect.gen(function* () {
        // Always return messageStarTokens (never undefined) for callers.
        const tokensOf = (m: MessageV2.WithParts) => Math.ceil(contentChars([m]) / CHARS_PER_TOKEN)

        if (Option.isSome(statusOpt)) {
          const currentStatus = yield* statusOpt.value.get(input.sessionID)
          if (currentStatus.type === "compacting") {
            log.debug("compaction skipped: already in progress", { sessionID: input.sessionID })
            return { messageStarTokens: 0 }
          }
          yield* statusOpt.value.set(input.sessionID, { type: "compacting" })
        }

        const finish = (next: "idle" | "busy" = "idle") =>
          Option.isSome(statusOpt)
            ? statusOpt.value.set(input.sessionID, { type: next })
            : Effect.void

        // Read all messages — use a high limit to avoid silently dropping
        // summaries for long sessions (>500 messages). The default 500 in
        // session.messages() was a TUI guard, not appropriate for compaction.
        const msgs = (yield* session.messages({ sessionID: input.sessionID, limit: 10_000 }).pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
        )) as MessageV2.WithParts[] | undefined
        if (!msgs?.length) {
          yield* finish()
          return { messageStarTokens: 0 }
        }

        // session.messages → MessageV2.page() already returns chronological
        // order (SQL desc for "latest N", then items.reverse()). Do not reverse
        // again — that re-introduces newest-first Recent folds.

        const visible = msgs.filter((m) => !m.info.compacted)
        if (!visible.length) {
          yield* finish()
          return { messageStarTokens: 0 }
        }

        // Idempotent: only a single prior message* and nothing new to fold.
        if (!input.force && visible.length === 1 && isMessageStar(visible[0])) {
          log.debug("compaction skipped: already message* only", { sessionID: input.sessionID })
          yield* finish()
          return { messageStarTokens: tokensOf(visible[0]) }
        }

        // Find the prior message* (if any) to bound summary collection.
        // Collect summaries ONLY from messages created AFTER the last message* —
        // this keeps the messageStar bounded (O(1) growth) instead of accumulating
        // every summary from session start (O(n²) unbounded growth).
        // Older summaries remain recoverable via session-read using the chain link.
        const priorMsgStarIdx = (() => {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (isMessageStar(msgs[i])) return i
          }
          return -1
        })()
        const priorMsgStarId = priorMsgStarIdx >= 0 ? msgs[priorMsgStarIdx].info.id : undefined

        // Collect summaries from the current compaction window only.
        // Exact range links come from the SYSTEM summary-range parent comment,
        // never from model prose (IDs are not model-inferable facts).
        const summaries: { id: string; text: string; fromId?: string; toId?: string; diffs?: Snapshot.FileDiff[]; impact?: Snapshot.ImpactSummary; sidecar?: boolean }[] = []
        const sidecars = IncrementalCheckpoint.listOpen(input.sessionID)
        for (const checkpoint of sidecars) {
          summaries.push({
            id: checkpoint.id,
            text: checkpoint.body,
            fromId: checkpoint.fromMessageID,
            toId: checkpoint.toMessageID,
            diffs: checkpoint.diffs,
            impact: checkpoint.impact,
            sidecar: true,
          })
        }
        let latestSummaryIdx = -1
        const byId = new Map(msgs.map((m) => [m.info.id, m] as const))
        for (let i = 0; i < msgs.length; i++) {
          // Skip messages before (and including) the prior message* — their summaries
          // were already folded into that prior messageStar.
          if (priorMsgStarIdx >= 0 && i <= priorMsgStarIdx) continue
          const m = msgs[i]
          if (m.info.role === "assistant" && (m.info as any).summary) {
            const text = messageText(m)
            if (text) {
              const parentID =
                m.info.role === "assistant" ? (m.info as MessageV2.Assistant).parentID : undefined
              const parent = parentID ? byId.get(parentID) : undefined
              let fromId: string | undefined
              let toId: string | undefined
              if (parent) {
                for (const p of parent.parts) {
                  if (p.type !== "text" || typeof (p as { text?: string }).text !== "string") continue
                  const range = parseSummaryRange((p as { text: string }).text)
                  if (range) {
                    fromId = range.fromId
                    toId = range.toId
                    break
                  }
                }
              }
              // Fallback only if legacy summaries stored links in body before system stamp.
              if (!fromId || !toId) {
                const legacy = extractSummaryLinks(text)
                fromId = fromId ?? legacy.fromId
                toId = toId ?? legacy.toId
              }
              const diffs = parent?.info.role === "user" ? parent.info.summary?.diffs : undefined
              const impact = parent?.info.role === "user" ? parent.info.summary?.impact : undefined
              summaries.push({ id: m.info.id, text, fromId, toId, diffs, impact })
              if (!extractSemanticVector(text)) {
                log.debug("summary missing semantic vector", { id: m.info.id })
              }
            }
            latestSummaryIdx = i
          }
        }

        const latestSummaryId = latestSummaryIdx >= 0 ? msgs[latestSummaryIdx].info.id : undefined
        const latestSidecarBoundary = sidecars.at(-1)?.toMessageID
        const latestBoundaryId = [latestSummaryId, latestSidecarBoundary].filter(Boolean).sort().at(-1)

        // Recent = visible messages after the latest summary, excluding prior message*.
        // The prior message* is NOT re-collected — its summaries belong to the previous
        // compaction cycle and are recoverable via the chain link.
        let recent = visible.filter((m) => {
          if (isMessageStar(m)) return false
          if (!latestBoundaryId) return true
          return m.info.id > latestBoundaryId
        })

        // No summary yet: cap Recent at the same effective target used by Layer 1.
        // This keeps a low-context provider from immediately overflowing again.
        const threshold = input.threshold ?? SUMMARY_INTERVAL_TOKENS
        if (!summaries.length && contentChars(recent) >= threshold * CHARS_PER_TOKEN) {
          const start = trimToLastInterval(recent, threshold)
          recent = recent.slice(start)
        }

        // Collect decisions from the prior messageStar (if any) so they survive
        // across compaction cycles verbatim — "Inferred once, not re-Inferred."
        const priorMsgStar = visible.find((m) => isMessageStar(m))
        const priorDecisions = priorMsgStar
          ? extractDecisions(messageText(priorMsgStar))
          : undefined

        // Compute 1-based global offset of the first recent message
        // so the messageStar can render #N positions for session-read.
        let recentStartOffset: number | undefined
        if (recent.length > 0) {
          const firstRecentId = recent[0].info.id
          const idx = msgs.findIndex((m) => m.info.id === firstRecentId)
          if (idx >= 0) recentStartOffset = idx + 1 // 1-based
        }

        const combined = buildMessageStar({
          sessionID: input.sessionID,
          summaries,
          recent,
          recentStartOffset,
          priorDecisions,
          priorMessageStarId: priorMsgStarId,
        })

        // Soft-hide every currently visible message (DB retained for session-read).
        let compacted = 0
        for (const m of visible) {
          m.info.compacted = true
          yield* session.updateMessage(m.info)
          compacted++
        }

        // Persist compaction timestamp so session metadata reflects
        // that compaction has occurred (enables DB-level introspection).
        yield* session.setCompacting({ sessionID: input.sessionID })

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
        IncrementalCheckpoint.materialize({
          sessionID: input.sessionID,
          ids: sidecars.map((checkpoint) => checkpoint.id),
          messageID: msg.id,
        })

        // Token estimate of the messageStar (chars/4). Layer-1 open-window
        // recompute treats this body as the post-compact content baseline.
        const messageStarTokens = Math.ceil(combined.length / 4)

        log.info("compacted", {
          compacted,
          summaries: summaries.length,
          recent: recent.length,
          forced: input.force ?? false,
        })
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        yield* finish()
        return { messageStarTokens }
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
     * Layer 1: inject a summary request for the effective content window.
     * Range starts after the latest summary (or start of visible history).
     * If the open range exceeds that interval, trim from_id to its last range.
     */
    const injectSummaryRequest = (input: {
      sessionID: SessionID
      model: { providerID: ProviderID; modelID: ModelID }
      agent: string
      threshold?: number
    }) =>
      Effect.gen(function* () {
        const msgs = (yield* session.messages({ sessionID: input.sessionID, limit: 10_000 }).pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
        )) as MessageV2.WithParts[] | undefined

        // page() already returns chronological order (see compact() above).

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
          const threshold = input.threshold ?? SUMMARY_INTERVAL_TOKENS
          // Trim to the effective interval if the open segment is larger.
          if (contentChars(range) >= threshold * CHARS_PER_TOKEN) {
            range = range.slice(trimToLastInterval(range, threshold))
          }

          fromId = range[0]?.info.id ?? pool[0]?.info.id ?? "start"
          toId = range[range.length - 1]?.info.id ?? pool[pool.length - 1]?.info.id ?? "end"
        }

        // Last summary's SVM so the model can chain sv_dominant / key phrases
        let lastSv: SemanticVector | undefined
        if (msgs?.length) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].info.role === "assistant" && (msgs[i].info as any).summary) {
              const sv = extractSemanticVector(messageText(msgs[i]))
              if (sv) {
                lastSv = sv
                break
              }
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
        // SYSTEM Exact range (ignored → never in model context). parseSummaryRange / diffs use this.
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "text",
          text: summaryRangeSystemMarker(fromId, toId, input.sessionID),
          synthetic: true,
          ignored: true,
        })
        // Model sees prose only (SVM / goal / decisions / state).
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "text",
          text: summaryRequestProse(lastSv),
          synthetic: true,
        })
        log.info("injected summary request", {
          sessionID: input.sessionID,
          fromId,
          toId,
          lastSvDominant: lastSv?.dominant,
        })
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
    threshold: z.number().int().positive().optional(),
  }),
  (input) => runPromise((svc) => svc.compact(input)),
)

export type CompactResult = Awaited<ReturnType<typeof compact>>

export const injectSummaryRequest = fn(
  z.object({
    sessionID: SessionID.zod,
    model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
    agent: z.string(),
    threshold: z.number().int().positive().optional(),
  }),
  (input) => runPromise((svc) => svc.injectSummaryRequest(input)),
)

export * as SessionCompaction from "./compaction"
