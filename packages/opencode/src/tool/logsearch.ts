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

          // Build rg arguments
          const rgArgs: string[] = [
            "--no-heading",
            "--line-number",
            "--context", String(ctxLines),
            "--max-count", String(limit),
          ]

          // Level filter
          if (params.level) {
            const levelWord = params.level.toUpperCase()
            if (levelWord === "BUG") {
              rgArgs.push("-e", "bug:")
            } else if (levelWord === "ERROR" || levelWord === "WARN" || levelWord === "INFO") {
              rgArgs.push("-e", levelWord)
            }
          }

          // Time window filter via filename prefix glob
          if (params.since) {
            const msAgo = parseTimeWindow(params.since)
            if (msAgo !== null) {
              const glob = filenameGlobAfter(msAgo)
              if (glob) {
                rgArgs.push("--glob", glob)
              }
            }
          }

          rgArgs.push("-e", params.pattern)
          rgArgs.push(logDir)

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

          if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) {
            return {
              title: "LogSearch",
              metadata: { pattern: params.pattern, results: 0, error: result.exitCode },
              output: `rg failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "unknown error"}`,
            }
          }

          if (result.exitCode === 1 || !result.stdout.trim()) {
            return {
              title: "LogSearch",
              metadata: { pattern: params.pattern, results: 0, error: 0 },
              output: `No matches found in ${logDir}`,
            }
          }

          const lines = result.stdout.split("\n").filter((l: string) => l.trim())

          let output = `Log directory: ${logDir}\nPattern: ${params.pattern}${params.level ? ` (level: ${params.level})` : ""}\n\n`
          let totalSize = output.length

          for (const line of lines) {
            const lineOutput = line + "\n"
            output += lineOutput
            totalSize += lineOutput.length
            if (totalSize > 50 * 1024) {
              output += "... (output truncated)\n"
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

/** Generate a glob pattern to match filenames after a given ms cutoff. */
function filenameGlobAfter(msAgo: number): string | null {
  const cutoff = Date.now() - msAgo
  const prefix = String(cutoff).slice(0, 7)
  return `${prefix}*`
}
