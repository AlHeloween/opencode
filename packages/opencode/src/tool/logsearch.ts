import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"

import DESCRIPTION from "./logsearch.txt"

const MAX_RESULTS = 100
const DEFAULT_LIMIT = 20
const DEFAULT_CONTEXT = 2

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description: "Search pattern (regex or plain text)",
  }),
  level: Schema.optional(Schema.String).annotate({
    description: 'Log level filter: "ERROR", "WARN", "bug", "INFO"',
  }),
  since: Schema.optional(Schema.String).annotate({
    description: 'Time window (e.g. "5m", "1h", "30m", "today")',
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum results to return (default: 20, max: 100)",
  }),
  context: Schema.optional(Schema.Number).annotate({
    description: "Lines of context before and after each match (default: 2)",
  }),
})

type LogSearchMeta = {
  pattern: string
  results: number
  error: number
}

export const LogSearchTool = Tool.define(
  "logsearch",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { pattern: string; level?: string; since?: string; limit?: number; context?: number },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "logsearch",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              level: params.level,
              since: params.since,
            },
          })

          const ins = yield* InstanceState.context
          const logDir = Global.Path.log

          const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_RESULTS)
          const ctxLines = params.context ?? DEFAULT_CONTEXT

          // `level` is a FILTER, not a second pattern. The argv used to carry `-e ERROR -e pattern`,
          // which ripgrep reads as an ALTERNATION: every ERROR line came back whether or not the
          // pattern was in it, so a level-filtered search answered a different question than the one
          // asked, and its count was wrong. Both conditions now live in ONE expression — a JSON log
          // line carries its `level` before `message`, so the pattern must follow the level token on
          // the same line.
          const pattern = params.level ? `${levelToken(params.level)}.*${params.pattern}` : params.pattern

          // The window selects FILES, by comparing each name's own timestamp — never by matching a name.
          const files = filesInWindow(logDir, params.since)
          if (files && files.length === 0) {
            // Nothing was searched, so nothing may be reported as absent — say what was looked at.
            return {
              title: "LogSearch",
              metadata: { pattern: params.pattern, results: 0, error: 0 },
              output: `No log file inside the 'since: ${params.since}' window in ${logDir}. Nothing was searched, so this is not a statement about the logs.`,
            }
          }

          const rgArgs: string[] = [
            "--no-heading",
            "--line-number",
            "--context", String(ctxLines),
            "--max-count", String(limit),
            "-e", pattern,
          ]
          // Explicit files inside the window, or the whole directory when there is no window.
          if (files) rgArgs.push(...files.map((name) => `${logDir}/${name}`))
          else rgArgs.push(logDir)

          const result = yield* Effect.promise<{ stdout: string; stderr: string; exitCode: number }>(async (signal) => {
            // Pre-flight: check rg is available before spawning.
            const rgPath = Bun.which("rg")
            if (!rgPath) {
              return {
                stdout: "",
                stderr: "ripgrep (rg) is not installed",
                exitCode: -2,
              }
            }

            const proc = Bun.spawn([rgPath!, ...rgArgs], {
              stdout: "pipe",
              stderr: "pipe",
              signal,
            })

            const [stdout, stderr] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
            ])
            // Bun: proc.exitCode is a synchronous number|null (NOT a Promise).
            // Use proc.exited (Promise<number>) to await the actual exit code.
            const exitCode = await proc.exited

            return { stdout, stderr, exitCode }
          })

          if (result.exitCode === -2) {
            return {
              title: "LogSearch",
              metadata: { pattern: params.pattern, results: 0, error: -2 },
              output: "ripgrep (rg) is not installed. Install from https://github.com/BurntSushi/ripgrep",
            }
          }

          // rg exit 2 IS an error — a bad pattern, an unreadable path. The predicate used to EXEMPT it,
          // so the tool's own failure fell through to the branch below and printed as «No matches
          // found»: a broken instrument reporting absence. An error is reported as an error, with rg's
          // own words, and any matches it did print are a FLOOR (the earlier the failure, the less it
          // saw) — never a total.
          if (result.exitCode >= 2) {
            const seen = result.stdout.trim() ? result.stdout.split("\n").filter((l: string) => l.trim()).length : 0
            return {
              title: "LogSearch",
              metadata: { pattern: params.pattern, results: seen, error: result.exitCode },
              output: `rg failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "unknown error"}${seen > 0 ? `\n\n${seen} line(s) it managed to print before failing — a FLOOR, not a total.` : ""}`,
            }
          }

          if (result.exitCode === 1 || !result.stdout.trim()) {
            return {
              title: "LogSearch",
              metadata: { pattern: params.pattern, results: 0, error: 0 },
              output: `No matches found in ${logDir}${
                files ? ` (searched ${files.length} file(s) inside the '${params.since}' window)` : ""
              }`,
            }
          }

          const lines = result.stdout.split("\n").filter((l: string) => l.trim())

          let output = `Log directory: ${logDir}\nPattern: ${params.pattern}${params.level ? ` (level: ${params.level})` : ""}\n\n`
          let totalSize = output.length

          for (const [index, line] of lines.entries()) {
            const lineOutput = line + "\n"
            output += lineOutput
            totalSize += lineOutput.length
            if (totalSize > 50 * 1024) {
              // Print the ADDRESS of what was cut, and call the result a FLOOR. A truncated answer that
              // does not say how much it dropped reads as the whole answer.
              output += `... (truncated after ${index} of ${lines.length} lines rg returned — this is a FLOOR, not a total)\n`
              break
            }
          }

          return {
            title: "LogSearch",
            metadata: { pattern: params.pattern, results: lines.length, error: 0 },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** Parse a time window string like "5m", "1h", "30m", "today" into ms ago. */
function parseTimeWindow(since: string): number | null {
  const match = since.match(/^(\d+)\s*(m|min|h|hour|d|day)$/i)
  if (match) {
    const num = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()
    if (unit === "m" || unit === "min") return num * 60 * 1000
    if (unit === "h" || unit === "hour") return num * 60 * 60 * 1000
    if (unit === "d" || unit === "day") return num * 24 * 60 * 60 * 1000
  }
  if (since.toLowerCase() === "today") {
    const now = Date.now()
    return now % (24 * 60 * 60 * 1000)
  }
  return null
}

/** The token a log LINE carries for a level — the JSON field for ERROR/WARN/INFO, the marker for `bug`. */
export function levelToken(level: string): string {
  const word = level.toUpperCase()
  if (word === "BUG") return "bug:"
  if (word === "ERROR" || word === "WARN" || word === "INFO") return `"level":"${word}"`
  // An unknown level is passed through as WRITTEN rather than dropped: a filter that cannot be applied
  // must widen the search, never narrow it.
  return level
}

/**
 * The files inside a time window — selected by COMPARING each name's own timestamp.
 *
 * This replaces `filenameGlobAfter`, which built a glob from the cutoff's first SEVEN DIGITS
 * (`String(cutoff).slice(0, 7) + "*"`). Seven digits of a millisecond epoch pin a ~16-minute BAND, so
 * `since: 60m` matched only files whose name began inside that one band and returned «No matches»
 * while 79 matching lines sat in the directory (measured 2026-09-21). A window is a comparison, not a
 * name pattern.
 *
 * `null` means "no window — search everything". A name whose time cannot be read is KEPT, for the same
 * reason: only what can be PROVEN out of the window may be left out.
 */
export function filesInWindow(dir: string, since?: string): string[] | null {
  if (!since) return null
  const msAgo = parseTimeWindow(since)
  if (msAgo === null) return null
  const cutoff = Date.now() - msAgo
  return [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })].filter((name) => {
    const head = String(name).split("_")[0]
    if (!/^\d+$/.test(head)) return true
    return Number(head) >= cutoff
  })
}
