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
import { formatPlanStateText, type PlanStatePayload } from "@/util/plan-status"
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
/**
 * Recent-tail budget for m* (content tokens, chars/4): the last ~32K tokens
 * of REAL messages, copied verbatim. Selection walks the FULL message list
 * (compacted rows included) and skips memory-machinery rows — a prior m*
 * never enters another m*, every real message stays eligible. The tail is
 * rebuilt from the DB on every compact, so repeated compacts are idempotent
 * (content fixed point) and undo restores the exact content window per m*.
 */
export const RECENT_MIN_TOKENS = 32_768
/** Maximum total summary body text (tokens) included in m*. Older summaries are session-read only. */
export const MAX_SUMMARY_BODY_TOKENS = 32_768

const CHARS_PER_TOKEN = 4
const SUMMARY_TERMINAL_MARKER = "<!-- summary-terminal -->"

/**
 * User-visible Layer-1 panel (TUI). Same product as old inject summary body + Exact
 * stamp, but synthetic+ignored so it never enters agent/provider M.
 */
export const LAYER1_SUMMARY_MARKER = "=== LAYER-1 SUMMARY ==="
export const EXACT_SYSTEM_MARKER = "--- Exact (system) ---"

export function isLayer1SummaryText(text: string | undefined): boolean {
  return typeof text === "string" && text.trimStart().startsWith(LAYER1_SUMMARY_MARKER)
}

/** UI-only Layer-1 panel message — not agent content, not Recent fold material. */
export function isLayer1SummaryMessage(msg: MessageV2.WithParts): boolean {
  return msg.parts.some(
    (p) => p.type === "text" && isLayer1SummaryText((p as { text?: string }).text),
  )
}

/**
 * Old tested Exact stamp (system digits). Shared by legacy inject assistant parts
 * and sidecar UI/checkpoint display — same product, different placement.
 */
export function formatExactSystemStamp(input: {
  id: string
  fromId: string
  toId: string
  sessionID: string
  /** Sidecar uses checkpoint_id; legacy inject uses summary_message_id. */
  idKey?: "checkpoint_id" | "summary_message_id"
}): string {
  const idKey = input.idKey ?? "summary_message_id"
  return (
    `${EXACT_SYSTEM_MARKER}\n` +
    `links_info_mark: Exact — system-computed, not model output\n` +
    `body_info_mark: Inferred\n` +
    `${idKey}: \`${input.id}\`\n` +
    `from_id: \`${input.fromId}\`\n` +
    `to_id: \`${input.toId}\`\n` +
    `session_id: \`${input.sessionID}\`\n`
  )
}

/** Full user-facing Layer-1 panel: inferred body + Exact stamp (+ optional tool stats). */
export function formatLayer1SummaryDisplay(input: {
  checkpointID: string
  fromID: string
  toID: string
  sessionID: string
  body: string
  diffs?: Snapshot.FileDiff[]
  impact?: Snapshot.ImpactSummary
  planState?: PlanStatePayload
}): string {
  const exact = formatExactSystemStamp({
    id: input.checkpointID,
    fromId: input.fromID,
    toId: input.toID,
    sessionID: input.sessionID,
    idKey: "checkpoint_id",
  })
  const diffLines =
    input.diffs && input.diffs.length > 0
      ? [
          `tool_diff_files: ${input.diffs.length}`,
          `additions: ${input.diffs.reduce((sum, d) => sum + d.additions, 0)}`,
          `deletions: ${input.diffs.reduce((sum, d) => sum + d.deletions, 0)}`,
          ...input.diffs.slice(0, 12).map(
            (d) => `- ${d.file} (+${d.additions}/-${d.deletions} ${d.status ?? "modified"})`,
          ),
          ...(input.diffs.length > 12 ? [`- … +${input.diffs.length - 12} more`] : []),
        ].join("\n")
      : "tool_diff_files: 0"
  const impactLine = input.impact
    ? `codegraph: changed_files=${input.impact.changedFiles}; callers=${input.impact.callerCount}`
    : "codegraph: none"
  const planStateBlock = input.planState
    ? [
        "### Plan state (GATED WORKFLOW)",
        ...(formatPlanStateText(input.planState) ?? "").split("\n"),
      ].join("\n")
    : undefined
  return [
    LAYER1_SUMMARY_MARKER,
    "",
    input.body.trim(),
    "",
    exact.trimEnd(),
    "",
    "### Exact handles (system)",
    diffLines,
    impactLine,
    planStateBlock,
  ].join("\n")
}

/** True only for the synthetic message* body produced by compact().
  * Must NOT match COMPACTION_REMINDER text that merely *mentions* the marker
  * (that reminder is injected onto every post-compact user message — matching
  * it would exclude all real user messages from the next message* Recent fold). */
/** True for the message* built by compact() (=== COMPACTED === + summary blocks). */
export function isMessageStar(msg: MessageV2.WithParts): boolean {
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
    // Layer-1 display panels are UI-only — never count toward open-window cadence.
    if (isLayer1SummaryMessage(m)) continue
    for (const p of m.parts) {
      // Count ALL text parts (including ignored) — consistent with messageText()
      if (p.type === "text") {
        const text = (p as any).text as string | undefined
        if (isLayer1SummaryText(text)) continue
        chars += text?.length ?? 0
      } else if (p.type === "reasoning") chars += (p as any).text?.length ?? 0
      else if (p.type === "tool") chars += (p.state as any)?.output?.length ?? 0
      else if (p.type === "subtask") chars += ((p as any).prompt?.length ?? 0) + ((p as any).description?.length ?? 0)
      else if (p.type === "patch") chars += ((p as any).content?.length ?? 0)
      // step-start, step-finish, snapshot, agent, retry, file, compaction — negligible, skip for perf
    }
  }
  return chars
}

function isSummaryAssistant(msg: MessageV2.WithParts): boolean {
  return msg.info.role === "assistant" && !!(msg.info as { summary?: boolean }).summary
}

/**
 * Recent tail for message* (compaction contract, 2026-08-29 Alexander):
 * a verbatim copy of the last ~minTokens of REAL messages — user, assistant,
 * reasoning, tool outputs, everything, whole messages, no re-rendering.
 *
 * Selection walks the FULL message list (compacted rows included) from the
 * end and skips memory-machinery rows: prior message* rows (an m* NEVER
 * enters another m*), Layer-1 UI panels, and legacy summary
 * requests/assistants (their content rides the summaries block). Real
 * messages folded into a prior m* tail are re-eligible — the tail is
 * rebuilt from the DB on every compact, which makes repeated compacts
 * idempotent: compact(m*) == m* (content fixed point).
 *
 * Floor semantics with whole-message granularity (2026-08-29 Alexander:
 * "30k +-"): walk back until the budget is reached, then stop — the last
 * collected message may overshoot the budget (never split a message).
 */
export function selectRecentTail(
  msgs: MessageV2.WithParts[],
  minTokens: number = RECENT_MIN_TOKENS,
): MessageV2.WithParts[] {
  const summaryParents = new Set<string>()
  for (const m of msgs) {
    if (isSummaryAssistant(m)) {
      const parentID = (m.info as MessageV2.Assistant).parentID
      if (parentID) summaryParents.add(parentID)
    }
  }
  const minChars = minTokens * CHARS_PER_TOKEN
  const selected: MessageV2.WithParts[] = []
  let chars = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!
    if (isMessageStar(m)) continue
    if (isLayer1SummaryMessage(m)) continue
    if (isSummaryRequestMessage(m)) continue
    if (isSummaryAssistant(m)) continue
    if (summaryParents.has(m.info.id)) continue
    selected.unshift(m)
    chars += contentChars([m])
    if (chars >= minChars) break
  }
  return selected
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
 * Layer-1 summary cadence: pure open-window content counter (65 536 tokens).
 * NOT context-clamped — small-context models must rely on Layer-2 compaction
 * instead of firing Layer-1 early. Regression: a ~40K-context model used to
 * get a threshold ≈12.5K from summaryWindowLimit and summarized at session
 * start with ~10K content. summaryWindowLimit is removed (2026-08-24): Layer-2
 * compact is mechanical — fixed SUMMARY_INTERVAL_TOKENS floor, window-independent.
 */
export function layer1SummaryThreshold(): number {
  return SUMMARY_INTERVAL_TOKENS
}

/**
 * Layer-1 summary **token counter**: content tokens (chars/4) of NEW work since
 * the last sidecar checkpoint, or of the entire visible list when none.
 *
 * message* is an ASSEMBLY of prior summaries + folded history, not new work:
 * it is never counted toward the increment (with no checkpoint boundary the
 * leading star chain is skipped). Otherwise every fold would leave the counter
 * at ~len(message*)/4 ≈ the whole 64K interval and a summary would fire on the
 * next stop regardless of real activity.
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
  } else {
    // No boundary (e.g. right after a fold): skip the leading message* chain.
    // The star is rebuilt from summaries — counting it as increment would make
    // the 64K cadence due immediately after every compact.
    while (start < msgs.length && isMessageStar(msgs[start])) start++
  }
  return Math.ceil(contentChars(msgs.slice(start)) / CHARS_PER_TOKEN)
}

/**
 * True when a compact can actually shrink M: any new content beyond a lone
 * message*. A lone star cannot be re-folded smaller (the no-s Recent trim
 * works on message boundaries and a star is a single message) — force must
 * NOT re-fold it, or the Layer-1 headroom gate would loop without progress.
 */
export function hasFoldableContent(visible: MessageV2.WithParts[]): boolean {
  if (visible.length === 0) return false
  if (visible.length > 1) return true
  return !isMessageStar(visible[0])
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

/** Minimum non-empty body chars per required section (rejects 3-sentence stubs). */
const MIN_SUMMARY_SECTION_CHARS: Record<string, number> = {
  "Semantic Vector": 25,
  Goal: 60,
  "Key decisions": 40,
  "Current state": 60,
}

/** Required Layer-1 sections with real content — not headings + one line. */
export function isValidSummaryBody(text: string): boolean {
  return diagnoseSummaryGaps(text).length === 0
}

/** Diagnostic: which required sections are deficient (empty = valid). */
export function diagnoseSummaryGaps(text: string): string[] {
  const gaps: string[] = []
  if (!text || text.trim().length < 200) {
    gaps.push("total_length")
    // Short-circuit — if the whole body is a stub, listing individual sections is noise.
    return gaps
  }
  for (const heading of ["Semantic Vector", "Goal", "Key decisions", "Current state"] as const) {
    // Do not use /m with `$` — `$` would match end-of-line and truncate sections.
    const section = text.match(new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"))
    const body = section?.[1]?.trim() ?? ""
    const min = MIN_SUMMARY_SECTION_CHARS[heading] ?? 40
    if (body.length < min) {
      gaps.push(`${heading} (${body.length}/${min} chars)`)
    }
  }
  // Key decisions must be actionable bullets, not a single vague sentence.
  const decisions = extractDecisions(text)
  if (decisions.length < 1) {
    gaps.push("Key decisions (0 bullets, need ≥1)")
  }
  return gaps
}

/** Targeted gap-fill request — only asks model for the deficient sections. */
export function gapFillRequest(originalBody: string, gaps: string[]): string {
  const gapList = gaps.map((g) => `- ${g}`).join("\n")
  return `Your Layer-1 summary body was received but these sections need more detail:

${gapList}

Reply with **only** the corrected sections using exactly these headings. Keep the content dense and specific — this is a memory handle, not a chat reply.

${gaps.filter((g) => !g.startsWith("total_length")).map((g) => {
    const heading = g.split(" (")[0]
    return `## ${heading}\n...`
  }).join("\n\n")}

Do NOT repeat the full summary or add introductory text. Start with \`## \`.`;
}

/** Parse gap-fill response and merge corrected sections into the original body.
  * Only sections present in the fill are replaced; everything else stays. */
export function mergeSummarySections(original: string, fillResponse: string): string {
  if (!fillResponse?.trim()) return original
  let merged = original
  for (const heading of ["Semantic Vector", "Goal", "Key decisions", "Current state"] as const) {
    const fillSection = fillResponse.match(
      new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"),
    )
    if (!fillSection?.[1]?.trim()) continue
    const fillBody = fillSection[1].trim()
    // Replace the original section with the filled one.
    const origSection = merged.match(
      new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"),
    )
    if (origSection) {
      merged = merged.replace(origSection[0], `## ${heading}\n${fillBody}`)
    } else {
      // Heading not present in original — append.
      merged = merged.trimEnd() + `\n\n## ${heading}\n${fillBody}`
    }
  }
  return merged
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
  * dominant-only since 2026-08-27: invented key_phrases had zero consumers —
  * the real task vectors live in the plan mirror (planState, see plan-status). */
interface SemanticVector {
  dominant?: string
}

/** Extract ## Semantic Vector dominant from summary text (both quote styles).
  * Legacy bodies with key_phrases stay readable — phrases are ignored. */
export function extractSemanticVector(text: string): SemanticVector | undefined {
  const match = text.match(/## Semantic Vector\s*\n([\s\S]*?)(?=\n## |\n--- |$)/i)
  if (!match?.[1]) return undefined
  // dominant: "..." or dominant: '...'
  const dominantMatch = match[1].match(/dominant:\s*["']([^"']+)["']/)
  if (!dominantMatch) return undefined
  return { dominant: dominantMatch[1] }
}

/**
 * Model-facing Layer-1 request: Inferred prose only (SVM, goal, decisions, state).
 * No digital facts — no IDs, diffs, hashes, codegraph. Those are system/fossil/CG.
 */
export function summaryRequestProse(lastSv?: SemanticVector, planGoalSv?: string[]) {
  const svHint = lastSv?.dominant
    ? `\nPrior window dominant (chain continuity only): "${lastSv.dominant}". Prefer a related dominant for continuity.\n`
    : ""
  const planHint = planGoalSv?.length
    ? `\nActive plan goal vocabulary: ${planGoalSv.join(", ")}. When this window serves that plan, align your dominant with it.\n`
    : ""
  return `You are writing a **Layer-1 memory summary** of the conversation window above (all prior messages in this request). This is the durable handle used after compaction — not a chat reply.

Write **Inferred** narrative only under the four headings below. Be specific and dense (names of systems, files, bugs, decisions). Thin 2–3 sentence stubs are **rejected**.
Do **not** call tools — write the summary as plain text only.
Do **not** invent or list message IDs, session IDs, database positions, file diffs, hashes, or codegraph data.
Do **not** open with "Sure" / "Here is a summary" — start with \`## Semantic Vector\`.
${svHint}${planHint}
## Semantic Vector
(The single semantic anchor of this window — one dominant phrase, no lists.)
Format:
  dominant: "<3-5 word phrase capturing the core intent>"

## Goal
(What the user was trying to accomplish in this window — at least a few sentences, concrete.)

## Key decisions
(Explicit decisions: approaches chosen, design tradeoffs.
Each decision on a separate line starting with "-". Specific and actionable —
this section is preserved verbatim across compaction cycles. At least one solid bullet.)

## Current state
(What was completed, what is in progress, what remains — concrete checklist-style prose, not one line.)`
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
    planState?: PlanStatePayload
    sidecar?: boolean
  }[]
  recent: MessageV2.WithParts[]
  /** 1-based global offset of the first recent message in the session.
    * Used to render `#N` positions so the model can call session-read
    * with an exact offset directly, without messagesearch indirection. */
  recentStartOffset?: number
  /** Prior message* ID — chain link for recovering older summaries via session-read. */
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
    const planStateLine = s.planState
      ? [
          `- plan_state: system Exact (GATED WORKFLOW mirror — kernel-native anchors)`,
          ...(formatPlanStateText(s.planState) ?? "")
            .split("\n")
            .map((l) => `  ${l}`),
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
      planStateLine,
      s.fromId ? `- from_id: \`${s.fromId}\`` : undefined,
      s.toId ? `- to_id: \`${s.toId}\`` : undefined,
      `- session_id: \`${input.sessionID}\``,
    ]
      .filter(Boolean)
      .join("\n")
    return `--- Summary ${i + 1} ---\n${links}\n\n${s.text}`
  })

  // Collect decisions from current summaries only (prior m* decisions are not pulled forward)
  const allDecisions = input.summaries.flatMap((s) => extractDecisions(s.text))
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

  // Passive links + ranks; ONE recovery pointer at the very end (2026-08-25,
  // Alexander): earlier "Fast recovery / use these tools" recipes sat at the
  // TOP and pushed models into session-read/db-read spirals instead of work.
  // A single closing line keeps the archive reachable without framing m* as
  // a recovery manual.
  const recoveryLine = "Use messagesearch, sessionread and dbread to restore missing facts."
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
    recoveryLine,
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
  }) => Effect.Effect<{ messageStarTokens: number; folded: boolean }>
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
              return { messageStarTokens: 0, folded: false }
          }
          yield* statusOpt.value.set(input.sessionID, { type: "compacting" })
        }

        const finish = (next: "idle" | "busy" = "idle") =>
          Option.isSome(statusOpt)
            ? statusOpt.value.set(input.sessionID, { type: next })
            : Effect.void

        // Read ALL messages — visible AND compacted (visibleOnly: false).
        // The compaction contract rebuilds the m* tail from true history:
        // real messages hidden by a prior compact are re-eligible, and legacy
        // summaries behind the prior m* carry forward. A high limit avoids
        // silently dropping rows for long sessions (>500 messages).
        const msgs = (yield* session.messages({ sessionID: input.sessionID, limit: 10_000, visibleOnly: false }).pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
        )) as MessageV2.WithParts[] | undefined
        if (!msgs?.length) {
          yield* finish()
          return { messageStarTokens: 0, folded: false }
        }

        // session.messages → MessageV2.page() already returns chronological
        // order (SQL desc for "latest N", then items.reverse()). Do not reverse
        // again — that re-introduces newest-first Recent folds.

        const visible = msgs.filter((m) => !m.info.compacted)
        if (!visible.length) {
          yield* finish()
          return { messageStarTokens: 0, folded: false }
        }

        // Idempotent: only a single prior message* and nothing new to fold.
        // Applies to force too — re-folding a lone star cannot shrink it (the
        // no-s Recent trim works on message boundaries and a star is one
        // message), so a forced re-fold would only loop with the Layer-1
        // summary headroom gate without ever making progress.
        if (visible.length === 1 && isMessageStar(visible[0])) {
          log.debug("compaction skipped: already message* only", { sessionID: input.sessionID })
          yield* finish()
          return { messageStarTokens: tokensOf(visible[0]), folded: false }
        }

        // Find the prior message* (if any) — it becomes the "Prior message*"
        // chain-link pointer of the new star (older stars stay session-read
        // addressable; the pointer is metadata, never folded content).
        const priorMsgStarIdx = (() => {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (isMessageStar(msgs[i])) return i
          }
          return -1
        })()
        const priorMsgStarId = priorMsgStarIdx >= 0 ? msgs[priorMsgStarIdx].info.id : undefined

        // Collect ALL checkpoints — open AND materialized. Summaries carry
        // forward across compacts (s0,s1 stay in every m* until the 32K pool
        // pushes the oldest out); the cap below keeps the block bounded.
        // Exact range links come from the SYSTEM summary-range parent comment,
        // never from model prose (IDs are not model-inferable facts).
        const summaries: { id: string; text: string; fromId?: string; toId?: string; diffs?: Snapshot.FileDiff[]; impact?: Snapshot.ImpactSummary; planState?: PlanStatePayload; sidecar?: boolean }[] = []
        const sidecars = IncrementalCheckpoint.listAll(input.sessionID)
        for (const checkpoint of sidecars) {
          summaries.push({
            id: checkpoint.id,
            text: checkpoint.body,
            fromId: checkpoint.fromMessageID,
            toId: checkpoint.toMessageID,
            diffs: checkpoint.diffs,
            impact: checkpoint.impact,
            planState: checkpoint.planState,
            sidecar: true,
          })
        }
        const byId = new Map(msgs.map((m) => [m.info.id, m] as const))
        for (let i = 0; i < msgs.length; i++) {
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
          }
        }

        // T2 refusal removed (2026-08-25): with zero summaries (manual
        // /compact on a fresh session, or a window-fill fold before the
        // first s) m* = header + Recent tail — the last RECENT_MIN_TOKENS
        // of real messages. The tail IS the memory: nothing is hidden
        // without representation, because the tail itself is kept.
        // (2026-08-16 incident invariant superseded by explicit design.)
        if (!summaries.length) {
          log.info("compaction: no summaries - folding recent tail only", {
            sessionID: input.sessionID,
            visible: visible.length,
            forced: input.force ?? false,
          })
        }

        // Cap total summary body text at MAX_SUMMARY_BODY_TOKENS tokens.
        // Older summaries become session-read only — not re-pulled into m*.
        {
          const maxChars = MAX_SUMMARY_BODY_TOKENS * CHARS_PER_TOKEN
          let totalChars = summaries.reduce((sum, s) => sum + s.text.length, 0)
          while (totalChars > maxChars && summaries.length > 1) {
            const removed = summaries.shift()!
            totalChars -= removed.text.length
          }
        }

        // Recent = verbatim copy of the last ~RECENT_MIN_TOKENS of REAL
        // messages. Selection walks the full message list (compacted rows
        // included) and skips memory-machinery rows — prior m* rows never
        // enter another m*; every real message (including ones folded into a
        // prior m* tail) is re-eligible. Deterministic → idempotent compacts.
        const recent = selectRecentTail(msgs, RECENT_MIN_TOKENS)

        // Prior m* decisions are NOT pulled forward — each m* owns its own decisions.

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
          priorMessageStarId: priorMsgStarId,
        })

        // Soft-hide every currently visible message (DB retained for
        // session-read). The new m* carries [summaries ≤32K tokens, last ≤32K
        // tokens of real messages]; older real messages stay in the archive —
        // they re-enter the tail on a future compact once the budget frees,
        // and the Prior message* chain link keeps every prior star
        // session-read addressable (undo restores the exact window per m*).
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
          recentTokens: Math.ceil(contentChars(recent) / CHARS_PER_TOKEN),
          recentMinTokens: RECENT_MIN_TOKENS,
          forced: input.force ?? false,
        })
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        yield* finish()
        return { messageStarTokens, folded: true }
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

    return Service.of({
      isOverflow: isOverflow as any,
      compact: compact as any,
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

export * as SessionCompaction from "./compaction"
