import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Memory } from "@/memory/memory"
import { getProjectDbPath } from "@/storage/db"
import * as Tool from "./tool"
import { optionalPattern } from "./pattern"

import DESCRIPTION from "./messagesearch.txt"

const MAX_OUTPUT = 50 * 1024

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "Search keywords or phrase. If empty, browses all user messages with context.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 20)",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description:
      "Regular expression applied to the matched text. FTS5 finds candidates by word; this filters them by shape — `reasoning_content` or `ckpt_[0-9a-f]+`. Usable on its own (omit `query`) to regex-scan a session.",
  }),
  ignoreCase: Schema.optional(Schema.Boolean).annotate({
    description: "Case-insensitive `pattern`. Default false.",
  }),
  session: Schema.optional(Schema.String).annotate({
    description:
      "Scope: 'all' (default, every session in the project), 'current' (this session only), or an explicit session id. Narrow it when a project-wide sweep buries the answer in other sessions' noise.",
  }),
})

/**
 * Resolve the scope to a session id, or undefined for the whole project.
 *
 * Default stays project-wide: `messagesearch` exists to find work done in other
 * sessions, and silently narrowing that would turn "no prior art" into a wrong
 * answer rather than a smaller one. Narrowing is the caller's choice.
 */
export function resolveScope(scope: string | undefined, current: string): string | undefined {
  if (scope === undefined || scope === "all") return undefined
  if (scope === "current") return current
  return scope
}

export const MessageSearchTool = Tool.define(
  "messagesearch",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
          params: { query?: string; limit?: number; session?: string; pattern?: string; ignoreCase?: boolean },
          ctx: Tool.Context,
        ) =>
        Effect.gen(function* () {
          const mode = params.query && params.query.trim().length > 0 ? "search" : "browse"
          const scope = resolveScope(params.session, ctx.sessionID)
          // Compiled before the DB is touched: a bad pattern should cost nothing.
          const filter = optionalPattern(params.pattern, params.ignoreCase)

          yield* ctx.ask({
            permission: "messagesearch",
            patterns: mode === "search" ? [params.query!] : ["*"],
            always: ["*"],
            metadata: {
              query: params.query || "(browse)",
              limit: params.limit,
              mode,
              session: scope ?? "all",
            },
          })

          const ins = yield* InstanceState.context
          const worktree = ins.worktree

          // Sync memory.db from project DB before querying
          const projectDbPath = getProjectDbPath(worktree)
          yield* Effect.sync(() => Memory.sync(worktree, projectDbPath))

          const limit = params.limit ?? 20

          if (mode === "browse") {
            return yield* Effect.gen(function* () {
              const results = Memory.browse({ worktree, sessionID: scope }).filter(
                (r) => !filter || filter.test(r.text),
              )

              if (results.length === 0) {
                return {
                  title: "Browse Sessions",
                  metadata: { query: "(browse)", mode, results: 0 },
                  output: "No results found",
                }
              }

              // Group by session, pair user messages with preceding assistant context
              let output = ""
              let totalSize = 0
              let currentSessionID = ""
              let sessionHeader = ""

              // Group results by session
              const sessionGroups = new Map<string, Memory.MemorySearchResult[]>()
              for (const r of results) {
                const group = sessionGroups.get(r.sessionID) ?? []
                group.push(r)
                sessionGroups.set(r.sessionID, group)
              }

              for (const [sessionID, groupResults] of sessionGroups) {
                if (totalSize >= MAX_OUTPUT) break
                const header =
                  `\n## Session: ${sessionID}\n` +
                  `info_mark: Inferred — index snippets; use sessionread for Exact.\n`
                output += header
                totalSize += header.length

                // Pair user messages with preceding assistant context
                let lastAssistantText = ""
                for (const result of groupResults) {
                  if (totalSize >= MAX_OUTPUT) break
                  if (result.role === "assistant") {
                    lastAssistantText = result.text
                  } else if (result.role === "user") {
                    if (lastAssistantText) {
                      const ctxEntry = [`### #${result.messageIndex - 1} [assistant]`, lastAssistantText, ""].join("\n")
                      output += ctxEntry
                      totalSize += ctxEntry.length
                      lastAssistantText = ""
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
                }
              }

              return {
                title: "Browse Sessions",
                metadata: {
                  query: "(browse)",
                  mode,
                  results: results.length,
                },
                output: output.slice(0, MAX_OUTPUT) || "No results found",
              }
            })
          }

          // Search mode: FTS5 + BM25 + epistemic hybrid
          return yield* Effect.gen(function* () {
            const searchResults = Memory.search({
              worktree,
              query: params.query!,
              limit,
              sessionID: scope,
            }).filter((r) => !filter || filter.test(r.text))

            if (searchResults.length === 0) {
              return {
                title: `MessageSearch "${params.query}"`,
                metadata: { query: params.query, mode, results: 0 },
                output: "No results found",
              }
            }

            // Group by session
            const sessionGroups = new Map<string, Memory.MemorySearchResult[]>()
            for (const r of searchResults) {
              const group = sessionGroups.get(r.sessionID) ?? []
              group.push(r)
              sessionGroups.set(r.sessionID, group)
            }

            let output = ""
            let totalSize = 0

            for (const [sessionID, groupResults] of sessionGroups) {
              if (totalSize >= MAX_OUTPUT) break
              const header =
                `\n## Session: ${sessionID}\n` +
                `info_mark: Inferred — index snippets; use sessionread for Exact.\n`
              output += header
              totalSize += header.length

              for (const result of groupResults) {
                if (totalSize >= MAX_OUTPUT) break

                const snippet = Memory.highlightSnippet(result.text, params.query!)
                const entry = [
                  `### #${result.messageIndex} [${result.partType}] ${result.messageID}`,
                  `Snippet: ${snippet}`,
                  `Rank: ${result.rank} (BM25: ${result.bm25Score}, Epistemic: ${result.epistemicScore})`,
                  "",
                ].join("\n")
                output += entry
                totalSize += entry.length
              }
            }

            return {
              title: `MessageSearch "${params.query}"`,
              metadata: {
                query: params.query,
                mode,
                results: searchResults.length,
              },
              output: output.slice(0, MAX_OUTPUT) || "No results found",
            }
          })
        }).pipe(Effect.orDie),
    }
  }),
)
