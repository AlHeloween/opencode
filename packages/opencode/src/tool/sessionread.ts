import { Effect, Schema } from "effect"
import { MessageV2 } from "../session/message-v2"
import { SessionID } from "../session/schema"
import * as Tool from "./tool"
import { optionalPattern } from "./pattern"

import DESCRIPTION from "./sessionread.txt"
import { Constitution } from "@/session/constitution"

const MAX_OUTPUT = 100 * 1024
const TOOL_OUTPUT_LIMIT = 500
const REASONING_OUTPUT_LIMIT = 500

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n... (truncated ${text.length - limit} more chars)`
}

export const Parameters = Schema.Struct({
  sessionId: Schema.String.annotate({ description: "The session ID to read messages from" }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "Start reading from this message index (1-based). If omitted, reads the most recent messages.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Number of messages to read (default: 10)",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description:
      "Regular expression. Only messages whose rendered text matches are returned, so a session can be searched instead of paged by offset.",
  }),
  ignoreCase: Schema.optional(Schema.Boolean).annotate({
    description: "Case-insensitive `pattern`. Default false.",
  }),
  raw: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true, skip compaction summary messages and show only original conversation. Default: false.",
  }),
})

/**
 * Does any part of this message match? Tool output and reasoning count — the
 * thing you are looking for in a session is as often in a command's output as
 * in what anyone said about it.
 */
export function matchesMessage(msg: MessageV2.WithParts, filter: RegExp): boolean {
  return msg.parts.some((part) => {
    if ("text" in part && typeof (part as { text?: unknown }).text === "string")
      return filter.test((part as { text: string }).text)
    if (part.type === "tool" && "state" in part) {
      const state = (part as { state?: { output?: string; error?: string } }).state
      return filter.test(state?.output ?? "") || filter.test(state?.error ?? "")
    }
    return false
  })
}

export const SessionReadTool = Tool.define(
  "sessionread",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: {
          sessionId: string
          offset?: number
          limit?: number
          raw?: boolean
          pattern?: string
          ignoreCase?: boolean
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "session-read",
            patterns: [params.sessionId],
            always: ["*"],
            metadata: {
              sessionId: params.sessionId,
              offset: params.offset,
              limit: params.limit,
            },
          })

          // Compiled before the stream opens: a bad pattern should cost nothing.
          const filter = optionalPattern(params.pattern, params.ignoreCase)

          const result = yield* Effect.sync(() => {
            const sid = params.sessionId as SessionID
            const messages: MessageV2.WithParts[] = []
            for (const msg of MessageV2.stream(sid)) {
              if (params.raw) {
                if (msg.info.role === "user" && msg.parts.some((p) => p.type === "compaction")) continue
                if (msg.info.role === "assistant" && (msg.info as any).summary) continue
              }
              // Match against every part's own text, not the rendered entry:
              // the rendering adds `#N <role>` and `[tool] …` labels, and a
              // pattern would otherwise hit its own scaffolding.
              if (filter && !matchesMessage(msg, filter)) continue
              messages.push(msg)
            }

            // MessageV2.stream yields newest-first (page() walks backward with
            // a descending cursor). Reverse to ascending so position 1 =
            // session start — the same convention as m* #N tags and the
            // "1-based message index" offset contract. The default view then
            // slices the TAIL (the newest messages); offset reads forward.
            messages.reverse()

            if (messages.length === 0) {
              return {
                output: `No messages found for session ${params.sessionId}`,
                title: `Session: ${params.sessionId}`,
                metadata: { offset: 0, limit: 0, total: 0 },
              }
            }

            const limit = Math.min(params.limit ?? 10, 50)
            const fromIndex = params.offset ?? (messages.length - limit + 1)

            let slice: MessageV2.WithParts[]
            if (params.offset !== undefined) {
              const start = Math.max(0, params.offset - 1)
              slice = messages.slice(start, start + limit)
            } else {
              slice = messages.slice(-limit)
            }

            let output = Constitution.sessionReadExactBanner(params.sessionId)
            let totalSize = output.length

            for (let i = 0; i < slice.length; i++) {
              if (totalSize >= MAX_OUTPUT) {
                output += `\n(truncated - showing ${i} of ${slice.length} messages)`
                break
              }

              const msg = slice[i]
              const idx = fromIndex + i
              const role = msg.info.role

              for (const part of msg.parts) {
                let text = ""
                if (part.type === "text" && "text" in part) {
                  text = part.text as string
                } else if (part.type === "tool" && "state" in part) {
                  const state = part.state as any
                  const raw = state.output || state.error || ""
                  text = raw ? `[${part.type}] ${truncate(raw, TOOL_OUTPUT_LIMIT)}` : `[${part.type} tool call]`
                } else if (part.type === "reasoning" && "text" in part) {
                  text = `[reasoning] ${truncate((part as any).text, REASONING_OUTPUT_LIMIT)}`
                } else if (part.type === "compaction" && "text" in part) {
                  text = `[summary] ${(part as any).text}`
                } else {
                  text = `[${part.type}]`
                }

                const entry = `#${idx} <${role}> ${text}\n`
                if (totalSize + entry.length > MAX_OUTPUT) {
                  output += `\n(truncated - output limit reached)`
                  break
                }
                output += entry
                totalSize += entry.length
              }
            }

            return {
              output,
              title: `Session: ${params.sessionId}`,
              metadata: { offset: fromIndex, limit: limit, total: messages.length },
            }
          })

          return result
        }).pipe(Effect.orDie),
    }
  }),
  "session-read",
)
