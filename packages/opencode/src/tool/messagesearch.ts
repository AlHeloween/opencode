import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "../session/session"
import { Provider } from "@/provider/provider"
import * as Tool from "./tool"

import DESCRIPTION from "./messagesearch.txt"

const MAX_OUTPUT = 50 * 1024

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "Search keywords or phrase. If empty, browses all user messages with context.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 20)",
  }),
})

export const MessageSearchTool = Tool.define(
  "messagesearch",
  Effect.gen(function* () {
    // Pre-build a model context limit lookup from all known providers.
    // Resolved once at tool init, safe to close over at execute time.
    const pvdr = yield* Provider.Service
    const allProviders = yield* pvdr.list()
    const contextMap = new Map<string, number>()
    for (const [providerID, provider] of Object.entries(allProviders)) {
      for (const [modelID, model] of Object.entries(provider.models)) {
        contextMap.set(`${providerID}:${modelID}`, model.limit.context)
      }
    }

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { query?: string; limit?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const mode = params.query && params.query.trim().length > 0 ? "search" : "browse"

          yield* ctx.ask({
            permission: "messagesearch",
            patterns: mode === "search" ? [params.query!] : ["*"],
            always: ["*"],
            metadata: {
              query: params.query || "(browse)",
              limit: params.limit,
              mode,
            },
          })

          const ins = yield* InstanceState.context
          const projectID = ins.project.id
          const worktree = ins.worktree

          // Resolve model context limit for browse mode token-aware sizing
          const modelContextLimit: number | undefined =
            mode === "browse"
              ? (() => {
                  const lastUser = ctx.messages.findLast((msg) => msg.info.role === "user")
                  if (!lastUser) return undefined
                  const m = (lastUser.info as any).model
                  if (!m?.providerID || !m?.modelID) return undefined
                  return contextMap.get(`${m.providerID}:${m.modelID}`)
                })()
              : undefined

          const results = yield* Effect.sync(() => {
            const groups: Session.SearchSessionGroup[] = []
            for (const group of Session.search({ projectID, worktree, query: params.query, limit: params.limit, modelContextLimit })) {
              groups.push(group)
            }
            return groups
          })

          if (results.length === 0) {
            return {
              title: mode === "browse" ? "Browse Sessions" : `MessageSearch "${params.query}"`,
              metadata: { query: params.query || "(browse)", mode, results: 0 },
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

            if (mode === "browse") {
              // Browse mode: show user messages with preceding assistant context
              for (const result of group.results) {
                if (totalSize >= MAX_OUTPUT) break
                if (result.contextText) {
                  const ctxEntry = [
                    `### #${result.contextIndex} [assistant]`,
                    result.contextText,
                    "",
                  ].join("\n")
                  output += ctxEntry
                  totalSize += ctxEntry.length
                }
                const userEntry = [
                  `### #${result.messageIndex} [user]`,
                  result.text ? `> ${result.text.slice(0, 400)}` : "",
                  "",
                ].join("\n")
                if (userEntry.trim()) {
                  output += userEntry
                  totalSize += userEntry.length
                }
              }
            } else {
              // Search mode: existing behavior with rank
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
          }

          return {
            title: mode === "browse" ? "Browse Sessions" : `MessageSearch "${params.query}"`,
            metadata: {
              query: params.query || "(browse)",
              mode,
              results: results.reduce((sum, g) => sum + g.results.length, 0),
            },
            output: output.slice(0, MAX_OUTPUT) || "No results found",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
