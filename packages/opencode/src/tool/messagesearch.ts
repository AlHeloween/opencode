import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Memory } from "@/memory/memory"
import { getProjectDbPath } from "@/storage/db"
import { IncrementalCheckpoint } from "@/session/incremental-checkpoint"
import type { SessionID } from "@/session/schema"
import { dominantLine, epochOpen, epochOrdinal, extractDominant, extractGoal, extractMessageDominant, parseRange, spineLine } from "@/memory/spine"
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
  corpus: Schema.optional(Schema.String).annotate({
    description:
      'Which corpus to read: "parts" (default — the indexed transcript across sessions, unchanged) or "summaries" (the session memory spine: one line per epoch, read from the compaction summaries).',
  }),
  dominant: Schema.optional(Schema.String).annotate({
    description:
      "With corpus=summaries, keep only epochs whose semantic dominant contains this text. The dominant is the one-line focus the agent writes for every window; filtering by it is searching meaning rather than words.",
  }),
  goals: Schema.optional(Schema.Boolean).annotate({
    description: "With corpus=summaries, also print each epoch's `## Goal` head under its spine line.",
  }),
  epoch: Schema.optional(Schema.Number).annotate({
    description:
      "With corpus=summaries, print ONLY that epoch's full body (1-based, in spine order). This is the second query: read the spine, then open the one epoch you need.",
  }),
  last: Schema.optional(Schema.Number).annotate({
    description:
      "Keep only the last N units of the selected corpus — epochs for corpus=summaries, message dominants for dominants: true. One name, one meaning: the unit is the corpus's own.",
  }),
  range: Schema.optional(Schema.String).annotate({
    description:
      'Restrict to a message range, in the form the spine prints: "<fromMessageID>..<toMessageID>". The cheap path — the same dominant filter over a whole session costs seconds.',
  }),
  dominants: Schema.optional(Schema.Boolean).annotate({
    description:
      "Descend one level: return the message-level semantic dominants instead of raw parts or snippets. Pair it with `range` (the address the spine printed) to open one epoch and see which of its messages were about what.",
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
          params: {
            query?: string
            limit?: number
            session?: string
            pattern?: string
            ignoreCase?: boolean
            corpus?: string
            dominant?: string
            goals?: boolean
            epoch?: number
            last?: number
            range?: string
            dominants?: boolean
          },
          ctx: Tool.Context,
        ) =>
        Effect.gen(function* () {
          const mode = params.query && params.query.trim().length > 0 ? "search" : "browse"
          const corpus = params.corpus === "summaries" ? "summaries" : "parts"
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

          // The corpus decides the default scope, so neither documented default is reversed:
          // prior-art search stays project-wide (`resolveScope` above), while the memory spine is
          // this session's own predecessor chain — the only thing "my memory" can mean.
          const spineScope =
            params.session === "all" ? undefined : resolveScope(params.session ?? "current", ctx.sessionID)

          // ONE metadata shape for every return below: `ExecuteResult<M>` infers M from EVERY
          // branch of `execute`, so a tool may not hand back two different key sets — the union
          // collapses and the keys that one branch omits become `undefined` against `number`.
          // The address therefore travels in the OUTPUT (where it is read) and in the title,
          // not in per-branch metadata fields.
          if (corpus === "summaries") {
            const sessionID =
              spineScope === undefined || spineScope === ctx.sessionID ? ctx.sessionID : (spineScope as SessionID)
            const epochs = IncrementalCheckpoint.listAll(sessionID).map((record, index) => ({
              ordinal: index + 1,
              record,
              dominant: extractDominant(record.body),
            }))
            const ignoredQuery =
              params.query && params.query.trim().length > 0
                ? `\nnote: \`query\` is ignored for corpus=summaries — the spine is not word-searched. Use \`dominant\` to keep only matching epochs.\n`
                : ""
            const notApplicable =
              params.dominants === true
                ? `\nnote: \`dominants\` does not apply here — every epoch already has exactly one dominant and the spine IS that list. To descend, use \`corpus: "parts", dominants: true, range: "<from>..<to>"\`.\n`
                : ""

            // The SECOND query: one epoch, whole. The spine exists so this call can be aimed.
            // `epoch: 0` means "not set", not "the epoch before the first one" — see epochOrdinal.
            const wantedEpoch = epochOrdinal(params.epoch)
            if (wantedEpoch !== undefined) {
              const chosen = epochs[wantedEpoch - 1]
              if (!chosen) {
                return {
                  title: `Memory Spine (epoch ${wantedEpoch} of ${epochs.length})`,
                  metadata: { query: params.query ?? "(spine)", mode: "summaries", results: 0 },
                  output: `No epoch ${wantedEpoch} — the spine holds ${epochs.length}`,
                }
              }
              return {
                title: `Memory Spine (epoch ${chosen.ordinal} of ${epochs.length}) · ${chosen.record.id}`,
                metadata: { query: params.query ?? "(spine)", mode: "summaries", results: 1 },
                // The address travels WITH the body: the caller needs the range for the descent,
                // and reconstructing it from the compaction anchor is the mechanism withholding
                // something it already has (same outside call, 2026-09-21).
                output: epochOpen({
                  id: chosen.record.id,
                  fromMessageID: chosen.record.fromMessageID,
                  toMessageID: chosen.record.toMessageID,
                  body: chosen.record.body,
                }),
              }
            }

            const wanted = params.dominant?.toLowerCase()
            const matched = wanted
              ? epochs.filter((epoch) => epoch.dominant?.toLowerCase().includes(wanted))
              : epochs
            const listed = params.last !== undefined ? matched.slice(-params.last) : matched

            const header =
              `## Memory spine — ${epochs.length} epoch(s)` +
              (wanted ? `, ${listed.length} matching "${params.dominant}"` : "") +
              `\ninfo_mark: Inferred — summary bodies are model prose; ids and ranges are Exact.` +
              `\nolder epochs are POINTERS, not current conclusions — a later epoch or sessionread is what confirms or refutes one.` +
              ignoredQuery +
              notApplicable +
              `\nsecond query: messagesearch { corpus: "summaries", epoch: N }\n`
            const lines = listed.map((epoch) => {
              const line = spineLine({
                ordinal: epoch.ordinal,
                dominant: epoch.dominant,
                agent: epoch.record.agent,
                modelID: epoch.record.modelID,
                id: epoch.record.id,
                fromMessageID: epoch.record.fromMessageID,
                toMessageID: epoch.record.toMessageID,
              })
              if (params.goals !== true) return line
              const goal = extractGoal(epoch.record.body)
              return goal ? `${line}\n   Goal: ${goal}` : line
            })

            const text = [header, ...lines].join("\n")
            return {
              title: `Memory Spine — ${listed.length} of ${epochs.length} epoch(s)${wanted ? ` matching "${params.dominant}"` : ""}`,
              metadata: { query: params.query ?? "(spine)", mode: "summaries", results: listed.length },
              output: text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) : text,
            }
          }

          // Level three: the messages of a range, projected onto their semantic dominants — the
          // descent the spine exists for. A range comes FIRST because it is the cheap path, and
          // that is a measurement, not a preference: the same marker filter over a whole session
          // costs ~1.5 s, while inside a range it costs milliseconds.
          if (params.dominants === true) {
            const parsed = params.range === undefined ? undefined : parseRange(params.range)
            if (params.range !== undefined && !parsed) {
              return {
                title: "Message dominants",
                metadata: { query: params.query ?? "(dominants)", mode: "dominants", results: 0 },
                output: `range must look like "<fromMessageID>..<toMessageID>" — got "${params.range}"`,
              }
            }

            const cap = 500
            const rows = Memory.listDominants({
              worktree,
              sessionID: spineScope,
              from: parsed?.from,
              to: parsed?.to,
              limit: cap,
            })
            const wanted = params.dominant?.toLowerCase()
            const projected = rows.map((row) => ({ row, dominant: extractMessageDominant(row.text) }))
            const matched = wanted
              ? projected.filter((entry) => entry.dominant?.toLowerCase().includes(wanted))
              : projected
            const listed = params.last !== undefined ? matched.slice(-params.last) : matched
            const scopeNote =
              parsed === undefined
                ? `\nnote: no range given, so every message in scope was scanned for dominants — pass the address the spine printed to make this cheap.\n`
                : ""
            const capNote = rows.length >= cap ? `\nnote: stopped at ${cap} carrying parts — narrow the range.\n` : ""
            const header =
              `## Message dominants — ${listed.length} of ${rows.length} carrier(s)` +
              (wanted ? `, matching "${params.dominant}"` : "") +
              `\ninfo_mark: Inferred — the dominant is model prose; indices and ids are Exact.\n` +
              scopeNote +
              capNote
            const lines = listed.map((entry) =>
              dominantLine({
                messageIndex: entry.row.messageIndex,
                dominant: entry.dominant,
                role: entry.row.role,
                partType: entry.row.partType,
                messageID: entry.row.messageID,
                partID: entry.row.partID,
              }),
            )
            const text = [header, ...lines].join("\n")
            return {
              title: `Message dominants — ${listed.length}`,
              metadata: { query: params.query ?? "(dominants)", mode: "dominants", results: listed.length },
              output: text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) : text,
            }
          }

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
