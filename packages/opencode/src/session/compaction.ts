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
import { readMemory } from "@/tool/memory"
import { EMPTY_HASH, KEYWORD_TOP_N, dominantLine, extractKeywords, extractMessageDominant, extractVectorChain } from "@/memory/spine"
import { estimateMediaTokens, estimateRequestTokens, isOverflow as overflow, usable } from "./overflow"
import { countTokens } from "./token-count"
import { promptTokensFromUsage } from "./processor"
import { makeRuntime } from "@/effect/run-service"
import { fn } from "@/util/fn"
import { SessionStatus } from "./status"
import { IncrementalCheckpoint } from "./incremental-checkpoint"
import { parseSummaryRange } from "./summary"
import { collectPlanState, formatPlanStateText, type PlanStatePayload } from "@/util/plan-status"
import { InstanceState } from "@/effect/instance-state"
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
/**
 * Summary cap (tokens) measured on the FULL RENDERED block — body + diff
 * snippets + impact + plan_state + Exact links, exactly the bytes
 * buildMessageStar injects. Body-only counting was a budget cheat: 76K of
 * bodies rendered into 237K of m* (2026-08-29, Alexander: "32k имелось ввиду
 * с дифами... сделай кэп на 16к"). Older summaries are session-read only.
 */
export const MAX_SUMMARY_BODY_TOKENS = 16_384

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
 * Recent tail for message* — the INVIOLATE copy of the current epoch.
 *
 * Owner ruling, 2026-09-19: «мы должны брать все токены с момента предыдущего
 * summary но не меньше чем 32к.» So the tail is EVERYTHING since the previous
 * summary, and 32k is a FLOOR that reaches further BACK — never a ceiling that
 * trims the epoch. The previous rule walked back to 32k and stopped wherever that
 * landed, so an epoch larger than the floor lost its OLDEST messages while the
 * fold still claimed «the tail IS the memory: nothing is hidden without
 * representation» — false for exactly the newest work.
 *
 * Selection walks the FULL message list (compacted rows included) from the end
 * and skips memory-machinery rows: prior message* rows (an m* NEVER enters
 * another m*), Layer-1 UI panels, and legacy summary requests/assistants (their
 * content rides the summaries block). Real messages folded into a prior m* tail
 * are re-eligible — the tail is rebuilt from the DB on every compact, which
 * makes repeated compacts idempotent: compact(m*) == m* (content fixed point).
 *
 * Whole-message granularity (2026-08-29 Alexander: "30k +-"): the message that
 * crosses the floor is kept WHOLE, so the tail may overshoot it — never split a
 * message. With no summary at all (a manual /compact on a fresh session) there is
 * no epoch boundary, and the floor alone decides, exactly as before.
 *
 * `coveredThroughIndex` — the 0-based index of the newest message a summary
 * actually COVERS — is the boundary the tail must be CONTIGUOUS with, and it is
 * passed in by the caller that parsed the ranges rather than re-derived here (one
 * implementation of "which messages are represented"). Using the summary ROW as
 * the boundary instead leaves a hole whenever a summary fired late: that covered
 * range ends at #50, the row sits at #80, and #51..#79 are represented by NOTHING
 * — «s..s..s [xxxxx what happened there?] tail» (owner, 2026-09-19). Everything
 * after the covered end is therefore MANDATORY tail, whatever its size.
 */
export function selectRecentTail(
  msgs: MessageV2.WithParts[],
  minTokens: number = RECENT_MIN_TOKENS,
  coveredThroughIndex?: number,
): MessageV2.WithParts[] {
  const summaryParents = collectSummaryParents(msgs)
  let lastSummary = -1
  for (let i = 0; i < msgs.length; i++) if (isSummaryAssistant(msgs[i]!)) lastSummary = i
  const minChars = minTokens * CHARS_PER_TOKEN
  const selected: MessageV2.WithParts[] = []
  let chars = 0
  // The covered end is authoritative when the caller could resolve it; the
  // summary ROW is only the fallback (a fixture or a legacy summary with no
  // from_id/to_id). `-1` = neither exists, so the floor is the only rule.
  const boundary = coveredThroughIndex ?? lastSummary
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!
    if (tailExclusion(m, summaryParents) !== undefined) continue
    // Everything after the covered end is MANDATORY tail — a message the
    // summaries do not cover is the hole, and no break may happen inside it,
    // however large it is. Only once we are at the represented region may the
    // floor stop the walk, which is why this check sits BEFORE the add: the
    // message at the boundary must not be conscripted into the tail.
    if ((boundary < 0 || i <= boundary) && chars >= minChars) break
    selected.unshift(m)
    chars += tailContentChars(m)
  }
  return selected
}

/** The message a summary hangs off — its content rides the summary block, so the
  * tail must not carry it a second time. */
function collectSummaryParents(msgs: MessageV2.WithParts[]): Set<string> {
  const parents = new Set<string>()
  for (const m of msgs) {
    if (!isSummaryAssistant(m)) continue
    const parentID = (m.info as MessageV2.Assistant).parentID
    if (parentID) parents.add(parentID)
  }
  return parents
}

/** WHY a row never renders into a tail, or `undefined` when it does.
  *
  * ONE predicate, shared by `selectRecentTail` and the closing range accounting.
  * Two definitions of "a message the tail renders" disagree INVISIBLY, and this
  * one already did: measured 2026-09-19, the first fold under the contiguity rule
  * printed `continuity: GAP — … 1 message(s) represented by neither`, and the
  * message was `msg_0b9bdc0b70011O6AWB9yu16rVD` — a Layer-1 panel
  * (`=== LAYER-1 SUMMARY ===`), i.e. machinery the selector drops BY DESIGN. A GAP
  * line that fires on a clean fold stops being evidence, and then a real hole
  * rides through with the false ones. */
function tailExclusion(m: MessageV2.WithParts, summaryParents: Set<string>): string | undefined {
  if (isMessageStar(m)) return "a prior m* row"
  if (isLayer1SummaryMessage(m)) return "a Layer-1 panel"
  if (isSummaryRequestMessage(m)) return "a summary request"
  if (isSummaryAssistant(m)) return "a summary row"
  if (summaryParents.has(m.info.id)) return "a summary anchor"
  return undefined
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
 * The newest message in the slice whose response carried a provider-billed prompt
 * size, and the index just past it.
 *
 * Those `tokens` are the provider's own count of everything that was on the wire for
 * that request — system prefix, tool schemas and message framing included — which is
 * exactly the part `estimateContentTokens` cannot see (measured on this session:
 * 493 088 tokens of parts + 99 390 of prefix/schemas/framing = 592 478 billed).
 */
/**
 * The newest message in the slice whose response carried a provider-billed prompt
 * size, and the tokens that message contributes to the window.
 *
 * Two parts, both from the provider and neither needing a tokenizer:
 *
 *   prompt   — the request's INPUT (`input + cache.read + cache.write`). That is the
 *              system prefix, the tool schemas and the message framing, i.e. exactly
 *              what `estimateContentTokens` cannot see (measured on this session:
 *              493 088 tokens of parts + 99 390 of prefix/schemas/framing = 592 478).
 *   response — the answer itself, which the provider also counted and which becomes
 *              part of the NEXT request's prompt. Reasoning rides the wire only on
 *              tool turns (`message-v2` strips it elsewhere), so it is added exactly
 *              then and not otherwise.
 *
 * `from: i + 1` — with the response included, growth is only what came after it: tool
 * results and new user messages, i.e. the one thing no provider has counted yet.
 */
function lastBilledPrompt(msgs: MessageV2.WithParts[]): { from: number; tokens: number } | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    const info = msg.info
    if (info.role !== "assistant") continue
    const prompt = promptTokensFromUsage(info.tokens)
    if (prompt <= 0) continue
    const reasoningCounts = msg.parts.some((p) => p.type === "tool")
    const response = info.tokens.output + (reasoningCounts ? info.tokens.reasoning : 0)
    return { from: i + 1, tokens: prompt + response }
  }
  return undefined
}

/**
 * Tokens per part id.
 *
 * A part is immutable once written, so this memo is exact, and it is what keeps the
 * counter affordable at all: the same window is walked two to three times per turn and
 * the tokenizer would otherwise re-read every part each time. Measured cost of NOT
 * having it — one prompt-suite case went 3.6 s → 17.2 s (2026-09-18).
 *
 * The key must name the STRING counted, not just the part: a `subtask` part carries two
 * of them (`prompt` and `description`), and keying both by `p.id` returned the first
 * one's count for the second.
 */
const partTokenCache = new Map<string, number>()
const PART_CACHE_MAX = 4096

function cachedCountTokens(key: string | undefined, text: string): number {
  if (!key) return countTokens(text)
  const hit = partTokenCache.get(key)
  if (hit !== undefined) return hit
  const tokens = countTokens(text)
  if (partTokenCache.size >= PART_CACHE_MAX) {
    // Drop the oldest quarter; a Map iterates in insertion order.
    let drop = PART_CACHE_MAX >> 2
    for (const evict of partTokenCache.keys()) {
      partTokenCache.delete(evict)
      if (--drop <= 0) break
    }
  }
  partTokenCache.set(key, tokens)
  return tokens
}

/**
 * Tokens for the parts that appeared from `from` onward, over the same part set
 * `contentChars` walks.
 *
 * This is the only stretch a tokenizer has to read — the provider has already counted
 * the prompt and its own response, so what remains is tool results (~2.8k chars at the
 * median, 188k at the observed maximum) plus any new user message: 1.2 ms typically,
 * 64 ms at the answer ceiling, against 967 ms for the whole visible window.
 */
function partTokens(msgs: MessageV2.WithParts[], from: number): number {
  let tokens = 0
  for (let i = from; i < msgs.length; i++) {
    if (isLayer1SummaryMessage(msgs[i])) continue
    for (const p of msgs[i].parts) {
      if (p.type === "text") {
        const text = (p as any).text as string | undefined
        if (isLayer1SummaryText(text)) continue
        tokens += cachedCountTokens(p.id, text ?? "")
      } else if (p.type === "reasoning") tokens += cachedCountTokens(p.id, (p as any).text ?? "")
      else if (p.type === "tool") tokens += cachedCountTokens(p.id, (p.state as any)?.output ?? "")
      else if (p.type === "subtask") {
        tokens +=
          cachedCountTokens(`${p.id}:prompt`, (p as any).prompt ?? "") +
          cachedCountTokens(`${p.id}:description`, (p as any).description ?? "")
      } else if (p.type === "patch") tokens += cachedCountTokens(p.id, (p as any).content ?? "")
    }
  }
  return tokens
}

/**
 * The window both counters walk: everything after the Layer-1 checkpoint boundary, or
 * after the leading message* chain when there is none.
 *
 * message* is an ASSEMBLY of prior summaries + folded history, not new work: it is
 * never counted toward the increment, or every fold would leave the counter at
 * ~len(message*)/4 ≈ the whole 64K interval and a summary would fire on the next stop
 * regardless of real activity.
 *
 * ONE resolver, because the cadence counter and the pre-send bound must walk a
 * byte-identical window — two thresholds disagreeing about what "the window" is is
 * what opened a ×3 blind band on 2026-09-15.
 */
function openWindowSlice(
  msgs: MessageV2.WithParts[],
  checkpointBoundaryID?: string,
): MessageV2.WithParts[] {
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
    while (start < msgs.length && isMessageStar(msgs[start])) start++
  }
  return msgs.slice(start)
}

/**
 * CONTENT tokens in the open window — the Layer-1 cadence counter.
 *
 * `chars/4` + media over the slice, and NOTHING from the provider. That is a SCOPE
 * rule, not a precision one: `prompt_tokens` measures a whole REQUEST (system prefix,
 * tool schemas and framing included), while Layer-1 asks how much NEW WORK accumulated
 * since the summary boundary. Feeding a whole-request number to a slice-relative
 * question opened this counter at ~99K on any billed session, straight through
 * `layer1SummaryThreshold()` (65 536) — the cadence silently became "summarize on every
 * stop" (found 2026-09-19). Its threshold is a CONTENT constant, so its number must be
 * content. Use {@link windowFillTokens} for window fill.
 */
export function computeOpenWindowTokens(
  msgs: MessageV2.WithParts[],
  checkpointBoundaryID?: string,
  model?: Provider.Model,
): number {
  const slice = openWindowSlice(msgs, checkpointBoundaryID)
  const media = model ? estimateMediaTokens(slice, model) : 0
  return Math.ceil(contentChars(slice) / CHARS_PER_TOKEN) + media
}

/**
 * REQUEST-space fill of the whole visible window: what the provider would bill for the
 * next request — its own count for the newest billed response, plus everything after
 * it.
 *
 * TWO RULES BIND EVERY CALLER, and both are about matching the number to its threshold:
 *
 *   SPACE — this is a REQUEST size, which already contains the system prefix and the
 *   tool schemas. Its threshold is therefore a request budget (`usable()`), never a
 *   content constant like Layer-1's 65 536.
 *
 *   SCOPE — call it WITHOUT a boundary. The base is a whole-request absolute, so a
 *   boundary slice would combine that absolute with a sub-window increment.
 *
 * ABSOLUTE FROM THE PROVIDER, GROWTH FROM THE TOKENIZER (2026-09-18): `prompt_tokens`
 * on the newest response is exact and already includes what the counter cannot see, so
 * only what came AFTER it needs counting — which keeps the tokenizer at 1.2 ms typically
 * instead of 967 ms for the whole window
 * (`experiments/2026-09-18_tokenizer-gap/bench.mts`).
 *
 * Media is still priced by DIMENSIONS (see `estimateMediaTokens`), never by tokenizing
 * bytes: doing that once produced ~688K phantom tokens and dropped a video (2026-09-07).
 * Only media in the GROWTH is added — the base already carries the images that were on
 * the wire when it was billed.
 */
export function windowFillTokens(msgs: MessageV2.WithParts[], model?: Provider.Model): number {
  const slice = openWindowSlice(msgs)
  const billed = lastBilledPrompt(slice)
  if (billed) {
    const growth = slice.slice(billed.from)
    const growthMedia = model ? estimateMediaTokens(growth, model) : 0
    // CHEAP BOUND FIRST, TOKENIZER ONLY NEAR THE EDGE (owner ruling 2026-09-18).
    //
    // Growth cannot cost more than ~2 tokens per character even in the worst BPE case
    // (measured worst is 1.30 chars/token, Chinese), so a slack twice the growth's
    // CHARACTER count cannot be closed by it. While that slack exists the exact count
    // changes no decision, and the tokenizer is skipped entirely — which is the whole
    // point of counting growth at all: a free answer stays free.
    const growthChars = contentChars(growth)
    const limit = model?.limit.context ?? 0
    if (limit > 0 && limit - billed.tokens > 2 * growthChars) {
      // Deliberately PESSIMISTIC (one token per character) rather than exact: the
      // number is compared against a threshold, and over-counting here can only fold
      // early, never let a real overflow through.
      return billed.tokens + growthChars + growthMedia
    }
    return billed.tokens + partTokens(slice, billed.from) + growthMedia
  }
  // No billed response in this window — a fresh session, or everything newer than the
  // fold. The estimate is the only instrument left, and it is expressed in the SAME
  // space as the billed figure (content + framing overhead) rather than as content
  // alone: a threshold cannot compare two different spaces.
  const media = model ? estimateMediaTokens(slice, model) : 0
  return estimateRequestTokens(Math.ceil(contentChars(slice) / CHARS_PER_TOKEN)) + media
}

/**
 * Average visible tokens added per user turn in the open window.
 *
 * One turn is not a rate: the first turn after a fold carries the folded star
 * and would read as an enormous burn, which would then report a headroom of
 * zero turns and provoke a pointless fold. Two is the smallest honest sample.
 */
export function burnRate(open: number, userTurns: number): number | null {
  if (userTurns < 2 || open <= 0) return null
  return open / userTurns
}

/**
 * One session's window arithmetic, computed ONCE and formatted by every consumer.
 *
 * Two surfaces report these numbers — the `checkstate` tool (pull) and the tail
 * note below (push) — and they must never disagree; a number and its threshold
 * living in different spaces is how the Layer-1 cadence silently became
 * "summarize on every stop" (2026-09-19). The spaces are fixed here, once:
 * `open` and `foldAt` are REQUEST-space (compared to the fold threshold),
 * `sinceSummary` is CONTENT-space (compared to the 65 536 cadence), and its
 * boundary is the newest OPEN summary — the same one the capture site uses.
 */
export type WindowState = {
  open: number
  foldAt: number
  sinceSummary: number
  perTurn: number | null
}

export function windowState(input: {
  visible: MessageV2.WithParts[]
  model: Provider.Model
  cfg: Config.Info
  /** Newest open summary's coverage end — the Layer-1 cadence boundary. */
  boundary?: MessageID
}): WindowState {
  const open = windowFillTokens(input.visible, input.model)
  return {
    open,
    foldAt: usable({ cfg: input.cfg, model: input.model }),
    sinceSummary: computeOpenWindowTokens(input.visible, input.boundary, input.model),
    perTurn: burnRate(
      open,
      input.visible.filter((m) => m.info.role === "user").length,
    ),
  }
}

/** The tag the pushed note is recognised by — its own idempotency key. */
export const TAIL_NOTE_PREFIX = "<compaction-status>"

/**
 * The note pushed onto the newest user message after every user turn: which
 * summaries are still OPEN and what is deficient in them, plus the distance to
 * both boundaries.
 *
 * WHY pushed, not pulled: these numbers used to live only behind `checkstate`,
 * and an identity mid-edit does not call a tool to ask how far the wall is — so
 * the fold arrived wherever it happened to land (owner ruling 2026-09-18). The
 * note rides the newest user message: new tokens by construction, so it costs
 * no cache (a counter in the system prefix would miss every turn), and it is
 * written once per user message rather than refreshed per step.
 *
 * WHY deadline-aware: only an OPEN summary gets a line — a folded one is `m*`
 * already and `summaryedit` refuses to touch it — and the gaps are computed
 * from the body ON READ, so filling a section retires its own nag without a
 * new column.
 */
export function tailNote(input: {
  open: { id: string; body: string }[]
  window: WindowState | null
}): string {
  const lines: string[] = []
  for (const summary of input.open) {
    const gaps = diagnoseSummaryGaps(summary.body)
    lines.push(
      gaps.length > 0
        ? `summary ${summary.id} open · gaps: ${gaps.join(", ")} · fill with summaryedit before the fold`
        : `summary ${summary.id} open · no gaps — folds into the next m* as-is`,
    )
  }
  if (input.window) {
    const w = input.window
    const headroom = Math.max(0, w.foldAt - w.open)
    const turns = w.perTurn && w.perTurn > 0 ? Math.floor(headroom / w.perTurn) : null
    const burn =
      turns === null
        ? `headroom ${headroom.toLocaleString("en-US")} (burn rate unknown — too few turns since the last fold)`
        : `headroom ${headroom.toLocaleString("en-US")} ~ ${turns} more turn${turns === 1 ? "" : "s"} at the recent ${Math.round(w.perTurn ?? 0).toLocaleString("en-US")}/turn (estimate)`
    lines.push(
      `ctx ${w.open.toLocaleString("en-US")}/${w.foldAt.toLocaleString("en-US")} · ${burn} · layer-1 ${w.sinceSummary.toLocaleString("en-US")}/${SUMMARY_INTERVAL_TOKENS.toLocaleString("en-US")}`,
    )
  }
  if (lines.length === 0) return ""
  return [TAIL_NOTE_PREFIX, ...lines, "</compaction-status>"].join("\n")
}

/**
 * Upper bound on the size of the NEXT request, with NO tokenizer — the pre-send fit
 * gate's instrument.
 *
 * It shares the cadence's BASE (the provider's own `prompt_tokens`, which already
 * contains the system prefix and tool schemas `estimateContentTokens` cannot see) and
 * prices the growth PESSIMISTICALLY at one token per character. No BPE reaches that:
 * the measured worst case is 1.30 chars/token (Chinese, 2026-09-18), so this is
 * genuinely an upper bound rather than an estimate pretending to be one.
 *
 * Why a bound and not the exact counter: this gate runs on the hot path, once per loop
 * step, before `llm.stream()`. Measured 2026-09-18 — pointing it at the exact fill
 * measure turned one prompt-suite case from 3.6 s into 17 s and stalled the whole file,
 * because near the edge that counter tokenizes the growth on every single call.
 * Over-counting here is safe BY CONSTRUCTION: the gate can only fold
 * early, never let a real overflow through — which is the failure it exists to prevent.
 *
 * Same SPACE and SCOPE rules as {@link windowFillTokens}: a REQUEST size, so its
 * threshold is `usable()`, and it is called without a boundary.
 *
 * With no billed response (fresh session) the previous estimate is returned unchanged,
 * so the change only reaches windows that carry a provider count, where the base is
 * measured rather than assumed.
 */
export function openWindowTokensBound(
  msgs: MessageV2.WithParts[],
  checkpointBoundaryID?: string,
  model?: Provider.Model,
): number {
  const slice = openWindowSlice(msgs, checkpointBoundaryID)
  const billed = lastBilledPrompt(slice)
  if (!billed) {
    const media = model ? estimateMediaTokens(slice, model) : 0
    return estimateRequestTokens(Math.ceil(contentChars(slice) / CHARS_PER_TOKEN)) + media
  }
  const growth = slice.slice(billed.from)
  return billed.tokens + contentChars(growth) + (model ? estimateMediaTokens(growth, model) : 0)
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
  // «Чёткие намерения с планами» (owner, 2026-09-21) — a plan is not the same axis as `Goal`
  // (why this window exists) or `Next Steps` (what to do next): it is the WORK being executed.
  // Riding inside another section is how it went missing in the first place, so it gets its own.
  Plan: 24,
  "Key decisions": 40,
  "Current state": 60,
  // The anchored template's four additions (owner ruling 2026-09-18). Lower
  // minima on purpose: the SHAPE is the contract, the detail is the model's
  // judgement. A 40-char floor on all eight turned every capture into a
  // gap-fill candidate, and a gap-fill candidate used to lose the whole
  // checkpoint (see the reject in prompt.ts) — which is a hole in memory, not
  // a style complaint. Continuity outranks completeness.
  "Constraints & Preferences": 24,
  "Next Steps": 24,
  "Critical Context": 24,
  "Relevant Files": 24,
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
  for (const heading of [
    "Semantic Vector",
    "Goal",
    "Plan",
    "Constraints & Preferences",
    "Current state",
    "Key decisions",
    "Next Steps",
    "Critical Context",
    "Relevant Files",
  ] as const) {
    // Do not use /m with `$` — `$` would match end-of-line and truncate sections.
    // Level-2 headings only: `### Done` / `### In Progress` / `### Blocked` live
    // INSIDE `## Current state` and do not terminate its body, so one floor
    // measures all three together. Enforcing the sub-headings needs a different
    // matcher and has no oracle yet — the prompt asks for them, the validator
    // does not grade them.
    const section = text.match(new RegExp(`## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"))
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
  // Heading line, then the body. A greedy whitespace run before the newline ate the blank line
  // after an EMPTY heading and began the capture at the NEXT section (measured on an empty
  // `## Plan`), so the vector of one section could be read out of another.
  const match = text.match(/## Semantic Vector[^\n]*\n([\s\S]*?)(?=\n## |\n--- |$)/i)
  if (!match?.[1]) return undefined
  // dominant: "..." or dominant: '...'
  const dominantMatch = match[1].match(/dominant:\s*["']([^"']+)["']/)
  if (!dominantMatch) return undefined
  return { dominant: dominantMatch[1] }
}

/** Extract ## Key decisions blocks from summary or messageStar text.
  * Returns each decision line (trimmed, non-empty, starting with "-").
  * Used to preserve decisions verbatim across compaction cycles. */
function extractDecisions(text: string): string[] {
  // Match ## Key decisions — heading line first, then the body. `\s*\n` here meant an EMPTY
  // decisions heading captured the NEXT section and its bullets were preserved across folds as
  // if they were decisions (measured on an empty `## Plan` in the gap validator, same matcher).
  const match = text.match(/## Key decisions[^\n]*\n([\s\S]*?)(?=\n## |\n--- |$)/i)
  if (!match?.[1]) return []
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
}

/** One collected summary: sidecar checkpoint or legacy assistant summary. */
type SummaryEntry = {
  id: string
  text: string
  fromId?: string
  toId?: string
  diffs?: Snapshot.FileDiff[]
  impact?: Snapshot.ImpactSummary
  planState?: PlanStatePayload
  sidecar?: boolean
}

/** Render one summary exactly as it appears inside m*. Single rendering path
 * shared with the budget cap — the cap can never drift from the injected
 * bytes (2026-08-29: body-only counting let 76K of bodies render into 237K). */
/**
 * The file-diff LEGEND a summary block carries: counts, then one address line per file — and NO
 * patch bodies.
 *
 * Bodies used to be inlined here (up to 40 lines per file × up to 20 files), so the block read as a
 * dump of code churn and the intention was displaced — the measured way a window's goals are lost
 * (owner, 2026-09-21: «умник решил проза не нужна и оставил только диффы»). The bodies are not the
 * record: the Exact list is recoverable from the session, and the header says where.
 */
export function renderFileDiffLegend(
  diffs: readonly { file: string; additions: number; deletions: number; status?: string }[],
  sidecar: boolean,
): string {
  const shown = diffs.slice(0, 20)
  const additions = diffs.reduce((sum, diff) => sum + diff.additions, 0)
  const deletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0)
  return [
    sidecar
      ? `- tool_diff: system Exact (snapshot range diff — fossil anchors + tool metadata; file bodies via sessionread of this range)`
      : `- tool_diff: system Exact (write/edit/multiedit filediff from session DB; file bodies via sessionread of this range)`,
    `  files=${diffs.length}; additions=${additions}; deletions=${deletions}`,
    ...shown.map((diff) => `  - ${diff.file} (+${diff.additions}/-${diff.deletions} ${diff.status ?? "modified"})`),
    ...(diffs.length > shown.length
      ? [`  - … +${diffs.length - shown.length} more; sessionread this summary range for the full Exact list`]
      : []),
  ].join("\n")
}

export function renderSummaryBlock(input: {
  sessionID: string
  s: SummaryEntry
  index: number
  /** 1-based position of a message id in the session, measured by the SAME walk
   * the tail's `#N` labels use. Present ⇒ the block prints from#/to#, so a
   * summary's coverage and the tail's range are one unit, not two. */
  positionOf?: (id: string) => number | undefined
}): string {
  const s = input.s
  const fromPos = s.fromId ? input.positionOf?.(s.fromId) : undefined
  const toPos = s.toId ? input.positionOf?.(s.toId) : undefined
  const sv = extractSemanticVector(s.text)
  const svLine = sv?.dominant ? `- sv_dominant: \`${sv.dominant}\`` : undefined
  const diffLine = s.diffs && s.diffs.length > 0 ? renderFileDiffLegend(s.diffs, !!s.sidecar) : undefined
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
    // Numbers beside the ids: the tail prints `#N` and these are the SAME
    // positions, so `to#` + 1 is where the tail must start — a gap is readable
    // rather than assumed away (owner, 2026-09-19: the message-number statistics
    // must be «непротиворечивая картина» and give «чёткий evidence»).
    fromPos != null ? `- from#: ${fromPos}` : undefined,
    toPos != null ? `- to#: ${toPos}` : undefined,
    `- session_id: \`${input.sessionID}\``,
  ]
    .filter(Boolean)
    .join("\n")
  // The INTENTION leads, the machinery follows (owner, 2026-09-21: «Summaries — там не проза
  // была а чёткие намерения с планами»). The block used to open with sv_dominant, tool_diff and
  // structural_impact and put the model's own Goal / decisions / next steps at the very bottom,
  // so the handle the next cycle reads showed the churn first and the purpose last — the same
  // displacement as the patch dump, one layer up. The Exact handles are still all here; they
  // simply no longer sit in front of the reason the window existed.
  return `--- Summary ${input.index + 1} ---\n\n${s.text}\n\n${links}`
}

// ── m* Recent-tail — the INVIOLATE copy (2026-09-19, owner ruling) ──
// «32к токенов хвоста должны быть неприкосновенны иначе это ломает тему. Всё что
// можно сжать у нас в memory и в summaries с дифами, и ещё если edit write был -
// значит был… если это корректировать то мы нарушаем chain of thoughts, что сразу
// потребует проверки и кажущаяся экономия превратится в серию припоминательных
// ходов.»
//
// So this renderer reduces NOTHING the model was shown. What it used to do,
// measured on the folded window of 2026-09-19 (substring of the m* part):
//   - the CALL half was never rendered at all: `[tool:edit] (completed)` +
//     "Edit applied successfully." — no file, no patch; `[tool:memory]` with no
//     content; `[tool:compact]` with no reason. Half of every exchange was
//     absent, so the window held the CONSEQUENCES of decisions without the
//     decisions, and the agent could not say why its own window had folded.
//   - every tool output but the newest 3 collapsed to 40 head + 10 tail lines.
//   - `reasoning` was dropped whole.
// The 2026-08-30 rationale ("facts, not process") and the ruling agree that
// compression belongs in memory and in summaries-with-diffs. What that rationale
// got wrong is that the CALL is not process — it is the fact of what was asked.
//
// Dropped are only what the WIRE also does not carry: <system-reminder> floods
// (read.ts injects AGENTS.md wholesale) and the [step-*] bookkeeping markers.
const TAIL_TOOL_OUTPUT_MAX_CHARS = MessageV2.REPLAY_TOOL_OUTPUT_MAX_CHARS
/** Decisions cap — the block accumulated monotonically (38K chars, uncapped). Newest kept. */
const DECISIONS_MAX_CHARS = 8_192
/** Table-of-contents cap — same discipline as decisions: newest lines kept, the trim NAMED. */
const TOC_MAX_CHARS = 8_192
/** How many terms the window's topical axis names — a glance, not a vocabulary. */
const TOC_TOPIC_COUNT = 8
/** Goal head — the owner's opening words are quoted, not paraphrased: three lines, then a named cut. */
const GOAL_HEAD_LINES = 3
const GOAL_MAX_CHARS = 400

function stripReminderBlocks(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/\n{3,}/g, "\n\n")
}

/** The CALL half of an exchange, in the shape the runtime already prints beside
 * a `read` attachment caption (prompt.ts:1388): `Called the <tool> tool with the
 * following input: {…}`. Empty when the part carries no input, so a part cannot
 * render a lie about itself. */
function toolCallText(part: { tool?: string; state?: { input?: unknown } }): string {
  if (part.state?.input === undefined) return ""
  const args = JSON.stringify(part.state.input)
  if (!args || args === "{}") return ""
  return `Called the ${part.tool ?? "?"} tool with the following input: ${args}\n`
}

/** Tool output at the size the CONVERSATION carried it: the wire caps a replayed
 * result at REPLAY_TOOL_OUTPUT_MAX_CHARS, so rendering a larger stored row in
 * full would put more in the tail than the model ever saw — a copy of the
 * database, not of the exchange. */
function tailToolOutput(output: string): string {
  if (output.length <= TAIL_TOOL_OUTPUT_MAX_CHARS) return output
  return `${output.slice(0, TAIL_TOOL_OUTPUT_MAX_CHARS)}\n… (+${output.length - TAIL_TOOL_OUTPUT_MAX_CHARS} chars beyond what the wire carried — recall(id) returns the stored result)`
}

/** Render-aware char count for tail selection. It measures EXACTLY what
 * `tailMessageText` emits — a budget that measures something else is the
 * two-measures-one-name defect, and it is what let the tail carry a call whose
 * size was never counted. `selectRecentTail` walks back to RECENT_MIN_TOKENS and
 * never splits a message, so the last collected message may overshoot. */
function tailContentChars(msg: MessageV2.WithParts): number {
  let chars = 0
  for (const p of msg.parts) {
    if (p.type === "text") chars += stripReminderBlocks((p as any).text ?? "").length
    else if (p.type === "reasoning") chars += ((p as any).text ?? "").length
    else if (p.type === "tool")
      chars +=
        toolCallText(p as never).length +
        tailToolOutput(stripReminderBlocks((p as any).state?.output ?? "")).length
    else if (p.type === "subtask") chars += ((p as any).prompt?.length ?? 0) + ((p as any).description?.length ?? 0)
    else if (p.type === "patch") chars += ((p as any).content?.length ?? 0)
    // step markers, snapshot/agent/retry — not rendered
  }
  return chars
}

/** Tail renderer: the message AS THE MODEL SAW IT — both halves of every tool
 * exchange, reasoning included, nothing collapsed. Exported so the rendering can
 * be pinned by a test on the bytes rather than through a whole fold (the artifact
 * is what caught the missing call half; string probes over guessed text missed it
 * three times). */
export function tailMessageText(msg: MessageV2.WithParts): string {
  const parts: string[] = []
  for (const p of msg.parts) {
    switch (p.type) {
      case "text":
        // Render ALL text parts regardless of `ignored` flag — dropping them
        // loses the user's actual words (see messageText).
        parts.push(`[text]\n${stripReminderBlocks((p as any).text ?? "")}`)
        break
      case "reasoning":
        parts.push(`[reasoning]\n${(p as any).text ?? ""}`)
        break
      case "tool": {
        const label = `[tool:${(p as any).tool}]`
        const status = (p as any).state?.status ?? "unknown"
        const raw = tailToolOutput(stripReminderBlocks((p as any).state?.output ?? ""))
        parts.push(`${label} (${status})\n${toolCallText(p as never)}${raw}`)
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
      case "snapshot":
        parts.push(`[snapshot: ${(p as any).hash ?? "?"}]`)
        break
      case "patch":
        parts.push((p as any).content ?? "")
        break
      case "agent":
        parts.push(`[agent: ${(p as any).agent ?? "?"}]`)
        break
      case "retry":
        parts.push(`[retry attempt=${(p as any).attempt ?? "?"}]`)
        break
      case "compaction":
      case "step-start":
      case "step-finish":
        break // markers only
    }
  }
  return parts.join("\n").trim()
}

/** m*'s closing continuity statement, as a PURE function so the RULE — not merely
  * its wiring — is falsifiable. A line that cannot fail proves nothing; a line
  * that fails on a clean fold is worse, because it retires the check itself.
  *
  * `between` = the rows strictly between the newest summary's coverage and the
  * tail's first message: `excluded` names the machinery the selector omits (so a
  * reader sees WHY the positions are not adjacent), `unrepresented` counts what is
  * neither covered nor in the tail — a real hole. */
export function continuityLine(args: {
  tailFirst: number
  summaryLast?: number
  between?: { excluded: string[]; unrepresented: number }
}): string {
  if (args.summaryLast == null)
    return "continuity: not verifiable here — the summaries carry no positions to compare against"
  if (args.tailFirst <= args.summaryLast + 1)
    return `continuity: summaries end at #${args.summaryLast}, tail starts at #${args.tailFirst} — no gap, no overlap`
  if (args.between != null && args.between.unrepresented === 0)
    return `continuity: summaries end at #${args.summaryLast}, tail starts at #${args.tailFirst} — no gap (excluded by design: ${args.between.excluded.join(", ")})`
  const unrepresented = args.between?.unrepresented ?? args.tailFirst - args.summaryLast - 1
  return `continuity: GAP — summaries end at #${args.summaryLast}, tail starts at #${args.tailFirst} (${unrepresented} message(s) represented by neither)`
}

/**
 * The TABLE OF CONTENTS of a folded window (owner, 2026-09-22): one line per message, taken from
 * the semantic dominant the message ALREADY carries.
 *
 * `@SV_FORMAT` writes a dominant at the end of every answer, so «чего же мы там делали» is not
 * something to DERIVE — it is a substring of rows that already exist (`memory/spine.ts` measured
 * the same idea at epoch level: 59 epochs = 4 248 characters against ~100k tokens for a raw
 * snapshot of the same window). What this replaces is a MODEL CALL at every fold that re-wrote,
 * worse, what the rows already say.
 *
 * A message with no dominant contributes no line — a smaller error than an invented one. Newest
 * lines are kept when the cap bites, and the trim is NAMED, so a short table is never mistaken
 * for a quiet window.
 *
 * Each line also carries the TOPIC AXIS: the top weighted terms the same message wrote, read
 * literally (left to right, stopping at the first chunk that is not `term weight`, never
 * renormalised — `extractKeywords`). The window's own axis is `topics` below.
 */
export function buildTableOfContents(
  entries: readonly { message: MessageV2.WithParts; position: number }[],
  input: { skipIds?: ReadonlySet<string>; maxChars?: number } = {},
): { lines: string[]; trimmed: number; topics?: string; chainBreaks: number } {
  const maxChars = input.maxChars ?? TOC_MAX_CHARS
  const kept: string[] = []
  const termCarriers = new Map<string, number>()
  let chars = 0
  let trimmed = 0
  let chainBreaks = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (input.skipIds?.has(entry.message.info.id)) continue
    const carrier = entry.message.parts.findLast((part) => {
      if (part.type !== "text") return false
      return extractMessageDominant((part as { text: string }).text) != null
    })
    if (!carrier) continue
    const text = (carrier as { text: string }).text
    const dominant = extractMessageDominant(text)
    const keywords = extractKeywords(text)
    // THE CHAIN BREAK — the marker ADID §I.14.3.1 describes, read instead of computed. A vector
    // declares its predecessor's hash; when the declaration does not match the previous message's
    // own md5, the thread was interrupted at a place the model itself named. Unknown cases (no
    // predecessor hash on either side) are NOT marked: a missing field is not a break.
    const chain = extractVectorChain(text)
    const olderEntry = i > 0 ? entries[i - 1] : undefined
    const olderCarrier = olderEntry?.message.parts.findLast((part) =>
      part.type === "text" && extractMessageDominant((part as { text: string }).text) != null,
    )
    const olderChain = olderCarrier
      ? extractVectorChain((olderCarrier as { text: string }).text)
      : undefined
    const brokenChain =
      chain.prevMd5 != null &&
      chain.prevMd5 !== EMPTY_HASH &&
      olderChain?.md5 != null &&
      chain.prevMd5 !== olderChain.md5
    if (brokenChain) chainBreaks++
    // The window's topical axis: how many vectors carry the term in their own top-N. A COUNT, not
    // a summed weight — adding weights across vectors would invent a probability nobody wrote.
    for (const entryTerm of keywords?.slice(0, KEYWORD_TOP_N) ?? []) {
      termCarriers.set(entryTerm.term, (termCarriers.get(entryTerm.term) ?? 0) + 1)
    }
    const line =
      dominantLine({
        messageIndex: entry.position,
        dominant,
        keywords,
        role: entry.message.info.role,
        partType: carrier.type,
        messageID: entry.message.info.id,
        partID: carrier.id,
      }) + (brokenChain ? ` \u26a0 chain break — sessionread back from here` : "")
    if (kept.length > 0 && chars + line.length + 1 > maxChars) {
      trimmed = i + 1
      break
    }
    kept.unshift(line)
    chars += line.length + 1
  }
  if (trimmed > 0) {
    kept.unshift(`… ${trimmed} older line(s) trimmed — sessionread the folded range for the full table`)
  }
  const topics =
    termCarriers.size > 0
      ? `- topics (how many vectors carry the term in their own top-${KEYWORD_TOP_N}): ${[...termCarriers.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOC_TOPIC_COUNT)
          .map(([term, count]) => `${term}×${count}`)
          .join(", ")}`
      : undefined
  return { lines: kept, trimmed, topics, chainBreaks }
}

/**
 * The GOAL of the window — READ, never derived (owner, 2026-09-22: «Единственное узкое место goal»).
 *
 * The dominant is in every message, but the goal never was: it lived in the summary body, i.e. in
 * the generation this revision removes. Two carriers already exist and both are reads:
 *   1. the PLAN — 24 files under `plans/` carry `<!-- intention: from -> to -->`, and
 *      `plan-status.ts` already parses it (`parseIntention`, `goal_sv`). The plan is the one place
 *      where the goal is written ONCE, by a mind, instead of being restated at every boundary;
 *      `collectPlanState(worktree)` is a plain read of those files.
 *   2. the OWNER'S OWN WORDS — the request that opened the window is the goal of that window, and
 *      it is Exact, not a summary of it.
 *
 * When neither carrier answers, the goal is UNKNOWN and says so: it is a record, never an argument,
 * and a boundary may not invent one.
 */
export function buildGoalLines(input: {
  planState?: PlanStatePayload
  window?: { messageID: string; position: number; text: string }
}): string[] {
  const lines: string[] = []
  const plan = input.planState?.plans.find((candidate) => candidate.intention)
  if (plan?.intention) {
    lines.push(`- goal (plan \`${plan.file}\`): ${plan.intention.from_state} -> ${plan.intention.to_state}`)
    if (plan.goal_sv.length > 0) lines.push(`- goal_sv: ${plan.goal_sv.join(", ")}`)
  }
  if (input.window) {
    const source = input.window.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const head = source.slice(0, GOAL_HEAD_LINES).join(" / ")
    const bounded = head.length > GOAL_MAX_CHARS ? head.slice(0, GOAL_MAX_CHARS) : head
    const cut = bounded.length < head.length || source.length > GOAL_HEAD_LINES
    lines.push(
      `- goal (window, owner's words — #${input.window.position} \`${input.window.messageID}\`): "${bounded}"${
        cut ? " …(cut — sessionread the message for the rest)" : ""
      }`,
    )
  }
  return lines.length > 0
    ? lines
    : ["- goal: Unknown — no plan carries an intention and no request opened this window"]
}

export function buildMessageStar(input: {
  sessionID: string
  summaries: SummaryEntry[]
  recent: MessageV2.WithParts[]
  /** The folded window's TABLE OF CONTENTS — one pre-rendered line per message, built from the
    * semantic dominant that message already carries (`buildTableOfContents`). */
  toc?: string[]
  /** The window's GOAL — pre-rendered lines from `buildGoalLines` (plan intention + the owner's
    * opening words), read at the fold rather than derived. */
  goal?: string[]
  /** The window's TOPICAL AXIS — one pre-rendered line from `buildTableOfContents` (`topics`). */
  topics?: string
  /** 1-based global offset of the first recent message in the session.
    * Used to render `#N` positions so the model can call session-read
    * with an exact offset directly, without messagesearch indirection. */
  recentStartOffset?: number
  between?: { excluded: string[]; unrepresented: number }
  /** Prior message* ID — chain link for recovering older summaries via session-read. */
  priorMessageStarId?: string
  /** 1-based position of a message id — the same walk the tail's `#N` uses. */
  positionOf?: (id: string) => number | undefined
  /** Permanent reasoning memory, folded in verbatim. Empty string when unwritten. */
  memory?: string
}): string {
  const summaryBlocks = input.summaries.map((s, i) =>
    renderSummaryBlock({ sessionID: input.sessionID, s, index: i, positionOf: input.positionOf }),
  )

  // Collect decisions from current summaries only (prior m* decisions are not pulled forward)
  const allDecisions = input.summaries.flatMap((s) => extractDecisions(s.text))
  // Cap newest-first (2026-08-30): the block accumulated monotonically (38K chars, uncapped).
  const keptDecisions: string[] = []
  let decisionsChars = 0
  for (let i = allDecisions.length - 1; i >= 0; i--) {
    const cost = allDecisions[i].length + 4
    if (keptDecisions.length > 0 && decisionsChars + cost > DECISIONS_MAX_CHARS) break
    keptDecisions.unshift(allDecisions[i])
    decisionsChars += cost
  }
  const trimmedDecisions = allDecisions.length - keptDecisions.length
  const decisionsBlock =
    keptDecisions.length > 0
      ? [
          "--- Decisions (preserved verbatim across compaction cycles) ---",
          `info_mark: Inferred — not re-summarized; preserved from original summary.`,
          `session_id: \`${input.sessionID}\``,
          ...(trimmedDecisions > 0
            ? [`(${trimmedDecisions} older decisions trimmed — sessionread the summaries for the full list)`]
            : []),
          "",
          ...keptDecisions.map((d) => `- ${d.replace(/^- /, "")}`),
        ].join("\n")
      : undefined

  // Last SV in this window — continuity hint for the next summary cycle
  const lastSummary = input.summaries[input.summaries.length - 1]
  const lastSv = lastSummary ? extractSemanticVector(lastSummary.text) : undefined

  const recentIds = input.recent.map((m) => m.info.id)
  const recentBlocks: string[] = []
  for (let i = 0; i < input.recent.length; i++) {
    const m = input.recent[i]!
    const offset = input.recentStartOffset != null ? input.recentStartOffset + i : undefined
    const offsetTag = offset != null ? ` #${offset}` : ""
    const body = tailMessageText(m)
    if (!body) continue // empty message (markers only) — drops out entirely
    recentBlocks.push(`[${m.info.role} \`${m.info.id}\`${offsetTag} info_mark=Mixed]\n${body}`)
  }

  const recentHeader =
    recentIds.length > 0
      ? `--- Recent (${recentBlocks.length}/${recentIds.length} messages: \`${recentIds[0]}\` .. \`${recentIds[recentIds.length - 1]}\`) ---\n` +
        `session_id: \`${input.sessionID}\`\n` +
        `info_mark: Mixed — working context (Inferred unless re-read).\n\n` +
        recentBlocks.join("\n\n")
      : `--- Recent ---\n(none — all history is covered by summaries above)\nsession_id: \`${input.sessionID}\`\ninfo_mark: Inferred`

  // Passive links + ranks; ONE recovery pointer at the very end (2026-08-25,
  // Alexander): earlier "Fast recovery / use these tools" recipes sat at the
  // TOP and pushed models into session-read/db-read spirals instead of work.
  // A single closing line keeps the archive reachable without framing m* as
  // a recovery manual.
  const recoveryLine =
    "Use messagesearch, sessionread and dbread to restore missing facts; recall(id) returns a dropped tool result in full."

  // Range accounting — the closing reference. m* has two halves and they must
  // read as ONE checkable picture: each Summary block prints from#/to# in the
  // same 1-based positions the tail prints as `#N`, and this states where the
  // tail begins. «В каждом summary указаны номера сообщений» — so the reader can
  // verify that the tail starts exactly where the newest summary ends, and a GAP
  // is NAMED here instead of being assumed away.
  const summaryStarts = input.summaries
    .map((s) => (s.fromId ? input.positionOf?.(s.fromId) : undefined))
    .filter((n): n is number => n != null)
  const summaryEnds = input.summaries
    .map((s) => (s.toId ? input.positionOf?.(s.toId) : undefined))
    .filter((n): n is number => n != null)
  const summaryFirst = summaryStarts.length > 0 ? Math.min(...summaryStarts) : undefined
  const summaryLast = summaryEnds.length > 0 ? Math.max(...summaryEnds) : undefined
  const tailFirst = input.recentStartOffset
  const tailLast = tailFirst != null && input.recent.length > 0 ? tailFirst + input.recent.length - 1 : undefined
  const rangeAccounting =
    tailFirst != null && tailLast != null
      ? [
          "--- Range accounting (system Exact — `#N` are the positions the Recent messages print) ---",
          summaryFirst != null && summaryLast != null
            ? `summaries: #${summaryFirst}..#${summaryLast} (each Summary block above lists its own from#/to#)`
            : "summaries: positions unavailable in this render (no from_id/to_id on the summaries)",
          `tail: #${tailFirst}..#${tailLast} (${input.recent.length} messages, verbatim — nothing in it is compressed)`,
          continuityLine({ tailFirst, summaryLast, between: input.between }),
        ].join("\n")
      : undefined

  // Permanent memory rides every fold verbatim. A summary is Inferred prose
  // about what happened; this is what an identity deliberately wrote down to
  // survive the boundary, so it is reproduced unsummarized and placed before
  // the summaries — it is the most durable thing in the star, not a recovery
  // recipe, and the closing pointer stays the only "go look it up" line.
  const memoryBlock = input.memory?.trim()
    ? [
        "<memory>",
        "info_mark: Exact — written deliberately, reproduced verbatim, not re-summarized.",
        "",
        input.memory.trim(),
        "</memory>",
      ].join("\n")
    : undefined

  // §2 order (owner, 2026-09-21): long-term memory FIRST — it is stable between folds, so its
  // head is what the prefix cache can hold — then the FADING LINKS AT ITS END, then summaries,
  // then the verbatim tail. `Prior message*` and the last semantic vector used to sit in the head,
  // ABOVE the memory: pointers to what the memory already covers, pushing the durable block down.
  const fadingLines = [
    ...(input.priorMessageStarId
      ? [`- Prior message*: \`${input.priorMessageStarId}\` — sessionread that row for the older summaries it chains`]
      : []),
    ...(lastSv?.dominant
      ? [`- Last semantic vector: \`${lastSv.dominant}\` — link your next summary to this`]
      : []),
  ]
  const fadingBlock =
    fadingLines.length > 0
      ? ["--- Fading (links only — the durable blocks above carry the content) ---", ...fadingLines].join("\n")
      : undefined

  const goalBlock =
    input.goal && input.goal.length > 0 ? ["--- Goal ---", ...input.goal].join("\n") : undefined
  const topicsBlock = input.topics
    ? ["--- Window topics (read from the vectors the rows carry) ---", input.topics].join("\n")
    : undefined
  const tocBlock =
    input.toc && input.toc.length > 0
      ? [
          "--- Table of contents (one line per folded message — the dominant it already carried) ---",
          "⚠ marks a DECLARED chain break: that message points back at a predecessor hash the previous message does not carry, so the thread was interrupted there.",
          ...input.toc,
        ].join("\n")
      : undefined

  return [
    "=== COMPACTED ===",
    "Active memory for this session. Older messages remain soft-hidden in the DB (not deleted).",
    "InfoMark: summary bodies = Inferred; system ID lines below = Exact handles; unaided recall = Guess.",
    "Continue the task from this memory. Re-read archive only when a specific fact is missing.",
    "",
    memoryBlock,
    goalBlock,
    fadingBlock,
    topicsBlock,
    tocBlock,
    ...summaryBlocks,
    decisionsBlock,
    recentHeader,
    rangeAccounting,
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
          // NEVER latch an m* row into the summaries block (Alexander:
          // "компакт всунутый в компакт это нонсенс"). A checkpoint body that
          // IS a prior m* is memory machinery, not a summary.
          if (checkpoint.body.trimStart().startsWith("=== COMPACTED ===")) {
            log.debug("checkpoint body looks like an m* row — skipped", { id: checkpoint.id })
            continue
          }
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
          if (isMessageStar(m)) continue // an m* NEVER enters another m*
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

        // Cap summaries at MAX_SUMMARY_BODY_TOKENS tokens measured on the
        // FULL RENDERED block — body + diff snippets + plan_state + links,
        // the exact bytes buildMessageStar injects. Body-only counting was a
        // budget cheat (76K bodies → 237K render, 2026-08-29). Oldest
        // summaries drop first — session-read only.
        // 1-based positions of our OWN messages: one walk, shared by the
        // summary blocks' from#/to# and by the tail's `#N`, so the two halves of
        // m* can be compared. The cap below renders through the SAME lookup, so
        // what it measures cannot drift from what gets injected.
        const positions = new Map<string, number>()
        msgs.forEach((m, i) => positions.set(m.info.id, i + 1))
        const positionOf = (id: string) => positions.get(id)
        // The boundary the tail must be CONTIGUOUS with: the newest message any
        // summary actually COVERS. The summary ROW is not the boundary — when a
        // summary fires late the messages between its covered range and its row
        // are represented by nothing, and taking the row would drop them
        // («s..s..s [xxxxx what happened there?] tail», owner 2026-09-19).
        const coveredPositions = summaries
          .map((s) => (s.toId ? positions.get(s.toId) : undefined))
          .filter((n): n is number => n != null)
        const coveredThroughIndex = coveredPositions.length > 0 ? Math.max(...coveredPositions) - 1 : undefined
        {
          const maxChars = MAX_SUMMARY_BODY_TOKENS * CHARS_PER_TOKEN
          const rendered = (s: SummaryEntry) =>
            renderSummaryBlock({ sessionID: input.sessionID, s, index: 0, positionOf }).length
          let totalChars = summaries.reduce((sum, s) => sum + rendered(s), 0)
          while (totalChars > maxChars && summaries.length > 1) {
            const removed = summaries.shift()!
            totalChars -= rendered(removed)
          }
        }

        // Recent = verbatim copy of the last ~RECENT_MIN_TOKENS of REAL
        // messages. Selection walks the full message list (compacted rows
        // included) and skips memory-machinery rows — prior m* rows never
        // enter another m*; every real message (including ones folded into a
        // prior m* tail) is re-eligible. Deterministic → idempotent compacts.
        const recent = selectRecentTail(msgs, RECENT_MIN_TOKENS, coveredThroughIndex)

        // The TABLE OF CONTENTS of this fold: the dominants the hidden rows already carry, so the
        // window keeps saying «что мы тут делали» without a model call (owner, 2026-09-22). Rows
        // kept verbatim in the tail are skipped — they are in the window as themselves.
        const toc = buildTableOfContents(
          visible.map((m) => ({ message: m, position: positions.get(m.info.id) ?? 0 })),
          { skipIds: new Set(recent.map((m) => m.info.id)) },
        )

        // The GOAL of this fold — the plan's intention (a read of the plan files) and the request
        // that opened the window, in the owner's own words. Neither carrier ⇒ Unknown, recorded.
        const openingRequest = visible.find(
          (m) =>
            m.info.role === "user" &&
            m.parts.some(
              (part) =>
                part.type === "text" &&
                !(part as { synthetic?: boolean }).synthetic &&
                (part as { text: string }).text.trim().length > 0,
            ),
        )
        const goal = buildGoalLines({
          planState: collectPlanState((yield* InstanceState.context).worktree),
          window: openingRequest
            ? {
                messageID: openingRequest.info.id,
                position: positions.get(openingRequest.info.id) ?? 0,
                text: openingRequest.parts
                  .filter(
                    (part) => part.type === "text" && !(part as { synthetic?: boolean }).synthetic,
                  )
                  .map((part) => (part as { text: string }).text)
                  .join("\n"),
              }
            : undefined,
        })

        // Prior m* decisions are NOT pulled forward — each m* owns its own decisions.

        // Compute 1-based global offset of the first recent message
        // so the messageStar can render #N positions for session-read.
        let recentStartOffset: number | undefined
        if (recent.length > 0) {
          const firstRecentId = recent[0].info.id
          const idx = msgs.findIndex((m) => m.info.id === firstRecentId)
          if (idx >= 0) recentStartOffset = idx + 1 // 1-based
        }

        // Rows strictly BETWEEN the covered end and the tail's first message, by
        // the SAME predicate the selector uses. The selector omits machinery by
        // design, so the closing reference must not call one a hole: it names them
        // and counts only the genuinely unrepresented. Rows that are neither = the
        // real hole, and only that number may reach the GAP branch.
        const betweenRows =
          coveredThroughIndex != null && recentStartOffset != null
            ? msgs.slice(coveredThroughIndex + 1, recentStartOffset - 1)
            : []
        const betweenParents = collectSummaryParents(msgs)
        const betweenExcluded = betweenRows
          .map((m) => tailExclusion(m, betweenParents))
          .filter((k): k is string => k != null)
        const between =
          betweenRows.length > 0
            ? { excluded: betweenExcluded, unrepresented: betweenRows.length - betweenExcluded.length }
            : undefined

        const combined = buildMessageStar({
          sessionID: input.sessionID,
          summaries,
          recent,
          toc: toc.lines,
          topics: toc.topics,
          goal,
          recentStartOffset,
          between,
          priorMessageStarId: priorMsgStarId,
          positionOf,
          memory: yield* readMemory(),
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
