import { Effect, Schema } from "effect"
import { Database as BunDatabase } from "bun:sqlite"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import path from "path"
import { existsSync } from "fs"
import { REPLAY_TOOL_OUTPUT_MAX_CHARS } from "../session/message-v2"
import { optionalPattern } from "./pattern"

import DESCRIPTION from "./recall.txt"

export type RecallSuccess = {
  ok: true
  tool: string
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
 * A failed result is NOT recoverable, deliberately: an error body is a dead end, and re-reading it
 * costs a round trip to learn nothing.
 */
export function readToolResult(input: {
  dbPath: string
  id: string
  range?: string
  pattern?: string
  ignoreCase?: boolean
  maxChars: number
}): RecallResult {
  if (!existsSync(input.dbPath)) return { ok: false, error: `database not found at ${input.dbPath}` }

  const db = new BunDatabase(input.dbPath, { readonly: true })
  try {
    const row = db.prepare("SELECT data FROM part WHERE id = ? LIMIT 1").get(input.id) as
      | { data: string }
      | undefined
    if (!row) return { ok: false, error: `no part with id ${input.id} in this project` }

    let part: { type?: string; tool?: string; state?: { status?: string; output?: string; error?: string; title?: string } }
    try {
      part = JSON.parse(row.data) as typeof part
    } catch (error) {
      return { ok: false, error: `part ${input.id} is unreadable: ${String(error)}` }
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

    // A trailing newline terminates the last line rather than opening an empty one.
    const all = output.split("\n")
    const lines = all.length > 1 && all[all.length - 1] === "" ? all.slice(0, -1) : all
    const totalLines = lines.length

    const window = parseRange(input.range, totalLines)
    if (!window.ok) return window

    let filter: RegExp | undefined
    try {
      filter = optionalPattern(input.pattern, input.ignoreCase)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const selected: Array<{ n: number; text: string }> = []
    for (let n = window.from; n <= Math.min(window.to, totalLines); n++) {
      const text = lines[n - 1] ?? ""
      if (filter && !filter.test(text)) continue
      selected.push({ n, text })
    }

    const chunks: string[] = []
    let used = 0
    let lastLine = 0
    for (const entry of selected) {
      const rowText = `${entry.n}: ${entry.text}\n`
      if (used + rowText.length > input.maxChars) break
      chunks.push(rowText)
      used += rowText.length
      lastLine = entry.n
    }
    // Never answer with an empty body when lines WERE selected: a single line longer than the cap is
    // cut instead, so the caller always learns the content starts here.
    if (selected.length > 0 && chunks.length === 0) {
      const first = selected[0]!
      chunks.push(`${first.n}: ${first.text}\n`.slice(0, input.maxChars))
      lastLine = first.n
    }

    const lastSelected = selected.length > 0 ? selected[selected.length - 1]!.n : 0
    const tool = part.tool ?? "tool"
    const title = part.state?.title ?? ""
    return {
      ok: true,
      tool,
      title,
      label: title ? `${tool}: ${title}` : tool,
      totalLines,
      totalChars: output.length,
      firstLine: chunks.length > 0 ? selected[0]!.n : 0,
      lastLine,
      matchedLines: selected.length,
      text: chunks.join(""),
      nextLine: lastLine > 0 && lastLine < lastSelected ? lastLine + 1 : null,
    }
  } catch (error) {
    return { ok: false, error: `lookup failed: ${String(error)}` }
  } finally {
    db.close()
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
})

export const RecallTool = Tool.define(
  "recall",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { id: string; range?: string; pattern?: string; ignoreCase?: boolean; maxChars?: number },
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
          })

          if (!result.ok) {
            return {
              title: `recall: ${params.id}`,
              metadata: { id: params.id, label: "", title: "", tool: "", totalLines: 0, totalChars: 0, matched: 0, returned: 0, error: result.error },
              output: `recall failed: ${result.error}`,
            }
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
