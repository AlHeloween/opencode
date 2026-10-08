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

// `toRustRegex` used to stand here and rewrite a BRE-style `\|` into `|` — i.e. into OR — while
// the shipped description says «`|` is OR; `\|` is a literal pipe», which is also what ripgrep's
// own dialect (Rust regex / ERE) means. A caller who read the description and asked for a literal
// pipe silently got an alternation instead: one spelling carrying two meanings, separated by a
// guess about the caller's dialect. The guess is gone — the pattern reaches ripgrep exactly as
// written, a literal pipe is `[|]` as it always was, and the description is now true. (The deleted
// function also carried a dead branch: both halves of its `if` appended `|`, so the `\\|` it
// promised to preserve was not preserved — a signature of a layer nobody could state precisely.)

/**
 * A match is reported as an ADDRESS plus a bounded window around the hit.
 *
 * Why not the line: a minified bundle is ONE line of megabytes. The previous code printed
 * `substring(0, MAX_LINE_LENGTH)`, anchored at the LINE START — so for a match deep inside
 * such a line it emitted thousands of characters that did not contain the match it reported,
 * and the caller had no way to tell. This window keeps `SNIPPET_MARGIN` characters on each
 * side of the hit, clips the hit itself past `MAX_MATCH_TEXT`, and `…` marks EVERY clip so a
 * window can never be mistaken for the whole line.
 *
 * A NUL byte in the line is MARKED too — `␀` (U+2400 SYMBOL FOR NULL). It is binary content that
 * ripgrep hands through `lines.text` (escaped in its JSON, decoded back into a real U+0000 by the
 * schema), and a raw 0x00 in the output is invisible in every terminal while corrupting anything
 * that later reads the text as bytes. Dropping it would silently join the two halves it keeps
 * apart — the same defect the clip marker exists to prevent. The address (line/col/offset) comes
 * from the raw hit, so the marking cannot move it. Reproduced 2026-10-08 on the file-target shape
 * (plan `2026-10-01_tool-description-contracts` C6).
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
  return { snippet: snippet.replaceAll("\u0000", "\u2400"), clipped: from > 0 || to < text.length || end > hitEnd }
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
          const pattern = params.pattern

          const empty = {
            title: pattern,
            metadata: { matches: 0, truncated: false },
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
          // REPORTING binary files was attempted here and reverted the same hour, with its test:
          // the count came back 0. The first explanation — «the resolved ripgrep does not emit
          // `binary_offset`» — is REFUTED by measurement: both `C:\Windows\rg.exe` (what `which`
          // resolves) and our bundled `bin/tools/rg.exe` emit it in `--json`, with the same events.
          // Cause UNKNOWN; the next instrument is a probe of `Ripgrep.search` on a NUL-containing
          // fixture, not another guess. Until then «No matches found» for a directory holding a
          // binary file remains a statement the tool cannot make.
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
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
