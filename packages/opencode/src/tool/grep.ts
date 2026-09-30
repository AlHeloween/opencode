import path from "path"
import { Schema } from "effect"
import { Effect, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"

const SNIPPET_MARGIN = 160
const MAX_MATCH_TEXT = 200

/**
 * Convert common regex patterns to Rust regex (ERE) format.
 * LLMs often generate BRE-style patterns (e.g. \| for OR) that don't
 * work in ripgrep's Rust regex engine where | is OR and \| is literal pipe.
 */
function toRustRegex(pattern: string): string {
  // BRE \| → ERE | (OR operator)
  // But not \\| (escaped backslash + pipe) or [|] (character class)
  // Strategy: replace \| with | but preserve \\|
  let result = ""
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\" && i + 1 < pattern.length && pattern[i + 1] === "|") {
      // Check if it's \\| (escaped backslash) — keep as-is
      if (i > 0 && pattern[i - 1] === "\\") {
        result += "|"
      } else {
        result += "|"
      }
      i++ // skip the |
    } else {
      result += pattern[i]
    }
  }
  return result
}

/**
 * A match is reported as an ADDRESS plus a bounded window around the hit.
 *
 * Why not the line: a minified bundle is ONE line of megabytes. The previous code printed
 * `substring(0, MAX_LINE_LENGTH)`, anchored at the LINE START — so for a match deep inside
 * such a line it emitted thousands of characters that did not contain the match it reported,
 * and the caller had no way to tell. This window keeps `SNIPPET_MARGIN` characters on each
 * side of the hit, clips the hit itself past `MAX_MATCH_TEXT`, and `…` marks EVERY clip so a
 * window can never be mistaken for the whole line.
 */
function matchWindow(text: string, hit?: { start: number; end: number }) {
  const start = Math.max(0, Math.min(hit?.start ?? 0, text.length))
  const end = Math.max(start, Math.min(hit?.end ?? start, text.length))
  const hitEnd = Math.min(end, start + MAX_MATCH_TEXT)
  const from = Math.max(0, start - SNIPPET_MARGIN)
  const to = Math.min(text.length, hitEnd + SNIPPET_MARGIN)
  const snippet =
    (from > 0 ? "…" : "") +
    text.slice(from, start) +
    text.slice(start, hitEnd) +
    (end > hitEnd ? "…" : "") +
    text.slice(hitEnd, to) +
    (to < text.length ? "…" : "")
  return { snippet, clipped: from > 0 || to < text.length || end > hitEnd }
}

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "Directory to search in. Omit for the working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File glob filter, e.g. "*.ts", "*.{js,jsx}".',
  }),
  gitignore: Schema.optional(Schema.Boolean).annotate({
    description:
      "Respect .gitignore. Default: false — every path is searched, including node_modules, .opencode/data and logs, so an absence can never be an artefact of an ignore rule.",
  }),
})

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string; include?: string; gitignore?: boolean }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.pattern) {
            throw new Error("pattern is required")
          }

          // Normalize regex for Rust engine (BRE → ERE)
          const pattern = toRustRegex(params.pattern)

          const empty = {
            title: pattern,
            metadata: { matches: 0, truncated: false, hidden_by_ignore: 0 },
            output: "No matches found",
          }

          yield* ctx.ask({
            permission: "grep",
            patterns: [pattern],
            always: ["*"],
            metadata: {
              pattern,
              path: params.path,
              include: params.include,
            },
          })

          const ins = yield* InstanceState.context
          const search = AppFileSystem.resolve(
            path.isAbsolute(params.path ?? ins.directory)
              ? (params.path ?? ins.directory)
              : path.join(ins.directory, params.path ?? "."),
          )
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const cwd = info?.type === "Directory" ? search : path.dirname(search)
          const file = info?.type === "Directory" ? undefined : [path.relative(cwd, search)]
          yield* assertExternalDirectoryEffect(ctx, search, {
            kind: info?.type === "Directory" ? "directory" : "file",
          })

          const result = yield* rg.search({
            cwd,
            pattern,
            glob: params.include ? [params.include] : undefined,
            file,
            signal: ctx.abort,
            gitignore: params.gitignore,
          })
          // The transparency probe that used to stand here is GONE, for the same reason as in
          // glob.ts: it existed to explain a «No matches found» produced by the DEFAULT hide. The
          // default now searches everything, so an empty result is simply an empty result.
          if (result.items.length === 0) return empty

          const rows = result.items.map((item) => ({
            path: AppFileSystem.resolve(
              path.isAbsolute(item.path.text) ? item.path.text : path.join(cwd, item.path.text),
            ),
            line: item.line_number,
            offset: item.absolute_offset,
            text: item.lines.text,
            hit: item.submatches[0],
          }))
          const times = new Map(
            (yield* Effect.forEach(
              [...new Set(rows.map((row) => row.path))],
              Effect.fnUntraced(function* (file) {
                const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!info || info.type === "Directory") return undefined
                return [
                  file,
                  info.mtime.pipe(
                    Option.map((time) => time.getTime()),
                    Option.getOrElse(() => 0),
                  ) ?? 0,
                ] as const
              }),
              { concurrency: 16 },
            )).filter((entry): entry is readonly [string, number] => Boolean(entry)),
          )
          const matches = rows.flatMap((row) => {
            const mtime = times.get(row.path)
            if (mtime === undefined) return []
            return [{ ...row, mtime }]
          })

          matches.sort((a, b) => b.mtime - a.mtime)

          const limit = 100
          const truncated = matches.length > limit
          const final = truncated ? matches.slice(0, limit) : matches
          if (final.length === 0) return empty

          const total = matches.length
          const output = [`Found ${total} matches${truncated ? ` (showing first ${limit})` : ""}`]

          let current = ""
          let clipped = 0
          for (const match of final) {
            if (current !== match.path) {
              if (current !== "") output.push("")
              current = match.path
              output.push(`${match.path}:`)
            }
            const { snippet, clipped: hitClipped } = matchWindow(match.text, match.hit)
            if (hitClipped) clipped++
            const column = (match.hit?.start ?? 0) + 1
            const at = match.offset + (match.hit?.start ?? 0)
            output.push(`  Line ${match.line}, col ${column}, offset ${at}: ${snippet}`)
          }

          if (clipped > 0) {
            output.push("")
            output.push(
              `(Match windows are bounded to ${SNIPPET_MARGIN} chars each side of the hit; … marks a clip — ${clipped} of ${final.length} shown were clipped.)`,
            )
          }

          if (truncated) {
            output.push("")
            output.push(
              `(Results truncated: showing ${limit} of ${total} matches (${total - limit} hidden). Consider using a more specific path or pattern.)`,
            )
          }

          if (result.partial) {
            output.push("")
            output.push("(Some paths were inaccessible and skipped)")
          }

          return {
            title: params.pattern,
            metadata: {
              matches: total,
              truncated,
              hidden_by_ignore: 0,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
