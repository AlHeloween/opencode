import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "../session/session"
import * as Tool from "./tool"

import DESCRIPTION from "./messagesearch.txt"

const MAX_OUTPUT = 50 * 1024

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The search query to find in conversation history",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 20)",
  }),
})

export const MessageSearchTool = Tool.define(
  "messagesearch",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { query: string; limit?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "messagesearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              limit: params.limit,
            },
          })

          const ins = yield* InstanceState.context
          const projectID = ins.project.id
          const worktree = ins.worktree

          const results = yield* Effect.sync(() => {
            const groups: Session.SearchSessionGroup[] = []
            for (const group of Session.search({ projectID, worktree, query: params.query, limit: params.limit })) {
              groups.push(group)
            }
            return groups
          })

          if (results.length === 0) {
            return {
              title: `MessageSearch "${params.query}"`,
              metadata: { query: params.query, results: 0 },
              output: "No results found",
            }
          }

          let output = ""
          let totalSize = 0

          for (const group of results) {
            if (totalSize >= MAX_OUTPUT) break
            const sessionTitle = group.results[0]?.sessionID || group.sessionID

            const header = `\n## Session: ${sessionTitle}\n`
            output += header
            totalSize += header.length

            for (const result of group.results) {
              if (totalSize >= MAX_OUTPUT) break

              const entry = [
                `### #${result.messageIndex} [${result.partType}] ${result.messageID}`,
                `Snippet: ${result.snippet}`,
                `Rank: ${result.rank}`,
                "",
              ].join("\n")
              output += entry
              totalSize += entry.length
            }
          }

          return {
            title: `MessageSearch "${params.query}"`,
            metadata: { query: params.query, results: results.reduce((sum, g) => sum + g.results.length, 0) },
            output: output.slice(0, MAX_OUTPUT) || "No results found",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
