import path from "path"
import { Schema } from "effect"
import { Effect, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"

const MAX_LINE_LENGTH = 2000

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

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
  noIgnore: Schema.optional(Schema.Boolean).annotate({
    description: "When true, ignores .gitignore and searches all files including node_modules, logs, and .opencode/data. Use this to search dependency code or runtime data. Default: false.",
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
      execute: (params: { pattern: string; path?: string; include?: string; noIgnore?: boolean }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.pattern) {
            throw new Error("pattern is required")
          }

          // Normalize regex for Rust engine (BRE → ERE)
          const pattern = toRustRegex(params.pattern)

          const empty = {
            title: pattern,
            metadata: { matches: 0, truncated: false },
            output: "No files found",
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
            noIgnore: params.noIgnore,
          })
          if (result.items.length === 0) return empty

          const rows = result.items.map((item) => ({
            path: AppFileSystem.resolve(
              path.isAbsolute(item.path.text) ? item.path.text : path.join(cwd, item.path.text),
            ),
            line: item.line_number,
            text: item.lines.text,
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
          for (const match of final) {
            if (current !== match.path) {
              if (current !== "") output.push("")
              current = match.path
              output.push(`${match.path}:`)
            }
            const text =
              match.text.length > MAX_LINE_LENGTH ? match.text.substring(0, MAX_LINE_LENGTH) + "..." : match.text
            output.push(`  Line ${match.line}: ${text}`)
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
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
