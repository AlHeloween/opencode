import { Effect, Schema } from "effect"
import { MessageV2 } from "../session/message-v2"
import { SessionID } from "../session/schema"
import * as Tool from "./tool"

import DESCRIPTION from "./session-read.txt"

const MAX_OUTPUT = 100 * 1024

export const Parameters = Schema.Struct({
  sessionID: Schema.String.annotate({ description: "The session ID to read messages from" }),
  fromIndex: Schema.optional(Schema.Number).annotate({
    description: "Start reading from this message index (1-based). If omitted, reads the most recent messages.",
  }),
  count: Schema.optional(Schema.Number).annotate({
    description: "Number of messages to read (default: 10)",
  }),
})

export const SessionReadTool = Tool.define(
  "session-read",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { sessionID: string; fromIndex?: number; count?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "session_read",
            patterns: [params.sessionID],
            always: ["*"],
            metadata: {
              sessionID: params.sessionID,
              fromIndex: params.fromIndex,
              count: params.count,
            },
          })

          const result = yield* Effect.sync(() => {
            const sid = params.sessionID as SessionID
            const messages: MessageV2.WithParts[] = []
            for (const msg of MessageV2.stream(sid)) {
              messages.push(msg)
            }

            if (messages.length === 0) {
              return {
                output: `No messages found for session ${params.sessionID}`,
                title: `Session: ${params.sessionID}`,
                metadata: { fromIndex: 0, count: 0, total: 0 },
              }
            }

            const count = Math.min(params.count ?? 10, 50)

            let slice: MessageV2.WithParts[]
            if (params.fromIndex !== undefined) {
              const start = Math.max(0, params.fromIndex - 1)
              slice = messages.slice(start, start + count)
            } else {
              slice = messages.slice(-count)
            }

            const firstIdx = params.fromIndex !== undefined ? params.fromIndex : Math.max(1, messages.length - count + 1)

            let output = `## Session: ${params.sessionID}\n`
            let totalSize = output.length

            for (let i = 0; i < slice.length; i++) {
              if (totalSize >= MAX_OUTPUT) {
                output += `\n(truncated - showing ${i} of ${slice.length} messages)`
                break
              }

              const msg = slice[i]
              const idx = firstIdx + i
              const role = msg.info.role

              for (const part of msg.parts) {
                let text = ""
                if (part.type === "text" && "text" in part) {
                  text = part.text as string
                } else if (part.type === "tool" && "state" in part) {
                  const state = part.state as any
                  text = state.output || state.error || `[${part.type} tool call]`
                } else if (part.type === "reasoning" && "text" in part) {
                  text = `[reasoning] ${(part as any).text}`
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
              title: `Session: ${params.sessionID}`,
              metadata: { fromIndex: firstIdx, count: slice.length, total: messages.length },
            }
          })

          return result
        }).pipe(Effect.orDie),
    }
  }),
)
