import { Effect, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import path from "path"
import { MessageV2, REPLAY_TOOL_OUTPUT_MAX_CHARS, resultLines, selectLines } from "../session/message-v2"
import { readStoredPart } from "../session/stored-part"
import { optionalPattern } from "./pattern"
import { Session } from "../session/session"

import DESCRIPTION from "./recall.txt"

/**
 * A stored tool part as it must be RETURNED TO BE WRITABLE. The identity lives in the `part` table
 * COLUMNS, not in the JSON blob, so a lookup that reads only `data` yields a part that looks complete
 * and cannot be written back — `session.updatePart` rejects it with "sessionID required but not
 * found", which is how `keep` silently persisted nothing until a live run caught it.
 */
export type StoredToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  tool: string
  callID: string
  state: {
    status?: string
    output?: string
    error?: string
    title?: string
    [field: string]: unknown
  }
}

export type RecallSuccess = {
  ok: true
  tool: string
  /** Set when the caller asked to KEEP this selection; the tool persists it onto the stored part. */
  kept?: { from: number; to: number; pattern?: string; ignoreCase?: boolean; reason?: string }
  /** The stored part, IDENTITY INCLUDED, ready to hand straight to `session.updatePart`. */
  part: StoredToolPart
  /** The stored `state.title` of that part — the same label the wire placeholder prints. */
  title: string
  /** `tool: title` (just the tool when it stored no title) — ONE handle, identical in both places. */
  label: string
  /** Lines in the stored result (a single trailing newline is a terminator, not a line). */
  totalLines: number
  totalChars: number
  /** Absolute 1-based line numbers of the returned window; 0 when nothing was returned. */
  firstLine: number
  lastLine: number
  /** Lines inside the window whose text matched `pattern` (equals the window size with no pattern). */
  matchedLines: number
  /** `N: text` rows, absolute numbers, so a later range can address what was just shown. */
  text: string
  /** Line to ask for next, or null when the window was fully delivered. */
  nextLine: number | null
}

export type RecallResult = RecallSuccess | { ok: false; error: string }

/**
 * `"0"` / `""` / `"all"` = the whole result. `"120-180"`, `"120-"`, `"-180"`, `"42"` as expected.
 * Rejecting a malformed range here rather than clamping it silently: a caller who typed `"180-120"`
 * wants to be told, not handed an empty body that looks like missing content.
 */
export function parseRange(
  range: string | undefined,
  totalLines: number,
): { ok: true; from: number; to: number } | { ok: false; error: string } {
  const raw = (range ?? "").trim()
  if (raw === "" || raw === "0" || raw.toLowerCase() === "all") return { ok: true, from: 1, to: totalLines }

  const span = raw.match(/^(\d*)\s*-\s*(\d*)$/)
  if (span) {
    const from = span[1] === "" ? 1 : Number(span[1])
    const to = span[2] === "" ? totalLines : Number(span[2])
    if (from < 1) return { ok: false, error: `range ${JSON.stringify(range)} is not 1-based` }
    if (to < from) return { ok: false, error: `range ${JSON.stringify(range)} ends before it starts` }
    return { ok: true, from, to }
  }

  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (n < 1) return { ok: false, error: `range ${JSON.stringify(range)} is not 1-based` }
    return { ok: true, from: n, to: n }
  }

  return {
    ok: false,
    error: `unrecognised range ${JSON.stringify(range)} — use "120-180", "120-", "-180", "42", or 0 for the whole result`,
  }
}

/**
 * Read a stored tool result by its PART id — the address `toolPlaceholder()` already prints on the
 * wire (`message-v2.ts:902`, `id=<partID>`). A plain keyed lookup: the placeholder hands over exactly
 * one id, so the way back takes exactly one id.
 *
 * It does NOT reuse `sessionread`, which truncates every tool output to 500 chars and therefore
 * cannot return what was dropped. Nor does it depend on the projected `type`/`status` columns being
 * current — the JSON in `data` is the authority, and a stale projection would silently hide a part
 * (measured: the live row carries both, but the lookup validates the JSON it is about to return).
 *
 * An ERRORED result is fully readable AND narrowable: it has no size gate at all, so it is the one
 * thing that spams the context with nothing able to shrink it, and `keep` is the way out.
 */
export function readToolResult(input: {
  dbPath: string
  id: string
  range?: string
  pattern?: string
  ignoreCase?: boolean
  maxChars: number
  /** Persist the selection onto the stored result, so later replays carry these lines and not a placeholder. */
  keep?: boolean
  /** WHY — carried into the persisted selection so a narrowed result can be audited later. */
  reason?: string
}): RecallResult {
  // ONE lookup, shared with every other writer (`@/session/stored-part`). The identity lives in the
  // table COLUMNS, so a lookup that selects `data` alone yields a part that reads back perfectly and
  // cannot be written — and two lookups would be two places that must remember that.
  const lookup = readStoredPart({ dbPath: input.dbPath, id: input.id })
  if (!lookup.ok) return { ok: false, error: lookup.error }
  try {
    const stored = lookup.part.json as {
      type?: string
      tool?: string
      callID?: string
      state?: StoredToolPart["state"]
    }
    const part: StoredToolPart = {
      id: lookup.part.id,
      sessionID: lookup.part.sessionID,
      messageID: lookup.part.messageID,
      type: stored.type ?? "",
      tool: stored.tool ?? "",
      callID: stored.callID ?? "",
      state: stored.state ?? {},
    }

    if (part.type !== "tool") return { ok: false, error: `part ${input.id} is a ${part.type ?? "unknown"} part, not a tool result` }
    // An ERRORED result is recallable on purpose. It is exactly what tells the caller to discard or
    // repair a step; refusing it — as this tool first did — makes a failure invisible behind a count
    // and removes the ability to filter errors of inference or of a tool call.
    const status = part.state?.status
    if (status !== "completed" && status !== "error") {
      return {
        ok: false,
        error: `part ${input.id} is ${status ?? "unknown"} — only a finished result can be recalled`,
      }
    }

    const output = status === "completed" ? (part.state?.output ?? "") : (part.state?.error ?? "")
    if (output.length === 0) return { ok: false, error: `part ${input.id} stored an empty result` }

    // ONE selector, shared with the replay rendering of a kept selection (`message-v2.selectLines`).
    // Two implementations would drift invisibly — the tool showing one thing and the wire another.
    const totalLines = resultLines(output).length

    const window = parseRange(input.range, totalLines)
    if (!window.ok) return window

    // Validate the pattern BEFORE selecting: a malformed regex is a user error with an obvious fix,
    // so it must come back as a message rather than die inside the selector.
    if (input.pattern !== undefined && input.pattern !== "") {
      try {
        optionalPattern(input.pattern, input.ignoreCase)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    const selection = selectLines(output, {
      from: window.from,
      to: window.to,
      pattern: input.pattern,
      ignoreCase: input.ignoreCase,
    })
    const selected = selection.rows

    const chunks: string[] = []
    let used = 0
    let lastLine = 0
    for (let i = 0; i < selected.length; i++) {
      const rowText = `${selected[i]}\n`
      if (used + rowText.length > input.maxChars) break
      chunks.push(rowText)
      used += rowText.length
      lastLine = selection.numbers[i] ?? 0
    }
    // Never answer with an empty body when lines WERE selected: a single line longer than the cap is
    // cut instead, so the caller always learns the content starts here.
    if (selected.length > 0 && chunks.length === 0) {
      chunks.push(`${selected[0]}\n`.slice(0, input.maxChars))
      lastLine = selection.numbers[0] ?? 0
    }

    const lastSelected = selection.numbers.length > 0 ? selection.numbers[selection.numbers.length - 1]! : 0
    const tool = part.tool ?? "tool"
    const title = part.state?.title ?? ""
    // A kept selection REPLACES the result on the wire, so it must never be allowed to blank it: a
    // selection that matched nothing would leave the model an EMPTY tool result carrying only its call
    // id, and the caller would have paid a round trip to destroy the content it was narrowing.
    if (input.keep === true && selected.length === 0) {
      return {
        ok: false,
        error:
          "nothing matched in that window, so keep would leave the result EMPTY — widen the range or drop the pattern, then keep",
      }
    }
    // `kept` works on an ERRORED result too, and there it matters most: an errored result has no size
    // gate at all, so a heavy failure replays in full on every later turn with nothing able to shrink
    // it. `recall(..., keep: true)` is that way out — clean the failure up on the fly and keep working.
    // What the caller asked to KEEP, ready to persist. Writing it is what turns this call from a cost
    // into an optimisation: from then on the replay carries these lines instead of the whole result.
    const kept =
      input.keep === true
        ? {
            from: window.from,
            to: Math.min(window.to, totalLines),
            ...(input.pattern ? { pattern: input.pattern } : {}),
            ...(input.ignoreCase ? { ignoreCase: true } : {}),
            ...(input.reason ? { reason: input.reason } : {}),
          }
        : undefined
    return {
      ok: true,
      tool,
      kept,
      part,
      title,
      label: title ? `${tool}: ${title}` : tool,
      totalLines,
      totalChars: output.length,
      firstLine: chunks.length > 0 ? (selection.numbers[0] ?? 0) : 0,
      lastLine,
      matchedLines: selected.length,
      text: chunks.join(""),
      nextLine: lastLine > 0 && lastLine < lastSelected ? lastLine + 1 : null,
    }
  } catch (error) {
    return { ok: false, error: `lookup failed: ${String(error)}` }
  }
}

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description:
      'Part id of an earlier tool result, exactly the `id=` value in its placeholder: `[grep id=prt_0b8da48fb001… — result delivered earlier (10.0 KB)]` → "prt_0b8da48fb001…".',
  }),
  range: Schema.optional(Schema.String).annotate({
    description:
      '1-based inclusive line range: "120-180", "120-" (to the end), "-180" (from the start), "42" (one line), or 0 for the whole result. Every answer prints absolute line numbers, so a range can be written against what you just saw.',
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description:
      "Regular expression; only lines inside the range whose text matches are returned. Their absolute line numbers are kept, so a follow-up range can widen around a hit.",
  }),
  ignoreCase: Schema.optional(Schema.Boolean).annotate({ description: "Case-insensitive `pattern`. Default false." }),
  maxChars: Schema.optional(Schema.Number).annotate({
    description: `Maximum characters of body to return (default ${REPLAY_TOOL_OUTPUT_MAX_CHARS}). Same ceiling the replay path applies — asking for more would be cut anyway.`,
  }),
  reason: Schema.String.annotate({
    description:
      "WHY you are reading or narrowing this result — e.g. \"need the failing assertion, the rest is noise\". Required, and stored with the kept selection, so a narrowed result can be audited afterwards.",
  }),
  keep: Schema.optional(Schema.Boolean).annotate({
    description:
      "Keep exactly this selection on the stored result. Use it to LEAVE only what you need: from then on the replay carries these lines instead of the placeholder, so the result stops costing what it used to. Ask for more later with another recall.",
  }),
})

export const RecallTool = Tool.define(
  "recall",
  Effect.gen(function* () {
    const session = yield* Session.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { id: string; range?: string; pattern?: string; ignoreCase?: boolean; maxChars?: number; keep?: boolean; reason: string },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "recall",
            patterns: [params.id],
            always: ["*"],
            metadata: { id: params.id, range: params.range, pattern: params.pattern },
          })

          const maxChars = Math.min(
            Math.max(1, Math.floor(params.maxChars ?? REPLAY_TOOL_OUTPUT_MAX_CHARS)),
            REPLAY_TOOL_OUTPUT_MAX_CHARS,
          )
          const result = readToolResult({
            dbPath: path.join(Global.Path.data, "opencode.db"),
            id: params.id,
            range: params.range,
            pattern: params.pattern,
            ignoreCase: params.ignoreCase,
            maxChars,
            keep: params.keep,
            reason: params.reason,
          })

          if (!result.ok) {
            return {
              title: `recall: ${params.id}`,
              metadata: { id: params.id, label: "", title: "", tool: "", totalLines: 0, totalChars: 0, matched: 0, returned: 0, error: result.error },
              output: `recall failed: ${result.error}`,
            }
          }

          // Persist the kept selection onto the stored part. From now on the replay renders exactly
          // these lines instead of a placeholder, so the result stops costing what it used to — this
          // is what makes the call an optimisation rather than a tax.
          if (result.kept !== undefined) {
            // `result.part` carries the table COLUMNS as well as the JSON, so this is typed rather
            // than asserted. The cast that used to sit here let a part with no `sessionID` look
            // correct at compile time and fail only at runtime — which is why keep never persisted.
            const stored = result.part
            yield* session.updatePart({
              id: stored.id,
              sessionID: stored.sessionID,
              messageID: stored.messageID,
              type: "tool",
              callID: stored.callID,
              tool: stored.tool,
              state: { ...stored.state, kept: result.kept },
            } as unknown as MessageV2.Part)
          }

          const scope = params.pattern ? `, pattern ${JSON.stringify(params.pattern)}` : ""
          const header =
            `recall: ${result.label} — id=${params.id}\n` +
            `range ${JSON.stringify(params.range ?? "0")} of ${result.totalLines} line(s), ${result.totalChars} chars${scope}\n` +
            (result.matchedLines === 0
              ? `no line matched in that range — widen the range or drop the pattern`
              : `showing ${result.text.split("\n").filter(Boolean).length} line(s), absolute ${result.firstLine}-${result.lastLine}` +
                (result.nextLine === null ? ` (complete)` : `; continue with range=${result.nextLine}-`))

          return {
            title: `recall: ${result.label} lines ${result.firstLine}-${result.lastLine} of ${result.totalLines}`,
            metadata: {
              id: params.id,
              label: result.label,
              title: result.title,
              tool: result.tool,
              totalLines: result.totalLines,
              totalChars: result.totalChars,
              matched: result.matchedLines,
              returned: result.text.length,
              error: "",
            },
            output: result.matchedLines === 0 ? header : `${header}\n\n${result.text}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
  "recall",
)
