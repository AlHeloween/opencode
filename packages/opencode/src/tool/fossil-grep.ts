import { Effect, Schema } from "effect"
import { execFile } from "child_process"
import path from "path"
import * as Tool from "./tool"
import { Global } from "@opencode-ai/core/global"
import DESCRIPTION from "./fossil-grep.txt"

function findFossil(): string {
  const fs = require("fs") as typeof import("fs")
  const names = process.platform === "win32" ? ["fossil.exe", "fossil"] : ["fossil", "fossil.exe"]
  const dirs = [
    path.join(path.dirname(process.execPath), "tools"),
    path.join(Global.Path.home, "tools"),
    path.join(Global.Path.home, "external", "fossil"),
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const c = path.join(dir, name)
      try {
        if (fs.existsSync(c)) return c
      } catch {
        /* continue */
      }
    }
  }
  return "fossil"
}

const FOSSIL_BIN = findFossil()

function fossilAsync(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      FOSSIL_BIN,
      args,
      { cwd, encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" }),
    )
  })
}

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "POSIX extended regular expression to search for" }),
  files: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "File paths to search. If omitted, searches all tracked files.",
  }),
  ignoreCase: Schema.optional(Schema.Boolean).annotate({
    description: "Case-insensitive search (default: false)",
  }),
  maxResults: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of version matches to return (default: 50)",
  }),
  once: Schema.optional(Schema.Boolean).annotate({
    description: "Stop after first match per file (default: false)",
  }),
})

export const FossilGrepTool = Tool.define(
  "fossil_grep",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; files?: string[]; ignoreCase?: boolean; maxResults?: number; once?: boolean }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const worktree = Global.Path.worktree || Global.Path.home

          // Get file list
          let files = params.files ?? []
          if (files.length === 0) {
            const ls = yield* Effect.promise(() => fossilAsync(["ls"], worktree))
            if (ls.code !== 0) {
              return { title: "fossil grep", metadata: { matches: 0 }, output: `Error: fossil not available or no repo: ${ls.stderr}` }
            }
            files = ls.stdout.trim().split("\n").filter(Boolean)
          }

          if (files.length === 0) {
            return { title: "fossil grep", metadata: { matches: 0 }, output: "No files to search." }
          }

          // Build grep args
          const args = ["grep"]
          if (params.ignoreCase) args.push("-i")
          if (params.once) args.push("--once")
          args.push(params.pattern)
          args.push(...files)

          const result = yield* Effect.promise(() => fossilAsync(args, worktree))

          if (result.code !== 0 && !result.stdout) {
            return {
              title: "fossil grep",
              metadata: { matches: 0 },
              output: `No matches found for: ${params.pattern}\n${result.stderr ? `Error: ${result.stderr}` : ""}`,
            }
          }

          // Parse output: == DATE FILE HASH checkin FULL_HASH  /  LINE:CONTENT
          const lines = result.stdout.trim().split("\n").filter(Boolean)
          const maxResults = params.maxResults ?? 50
          const parsed: string[] = []
          let totalMatches = 0

          for (const line of lines) {
            if (parsed.length >= maxResults) {
              parsed.push(`... (${lines.length - parsed.length - totalMatches} more results)`)
              break
            }

            if (line.startsWith("== ")) {
              const parts = line.split(/\s+/)
              const file = parts[2] ?? ""
              const hash = parts[3] ?? ""
              const checkin = parts[5] ?? ""
              parsed.push(`\n[${file}] version ${hash} (${checkin})`)
              continue
            }

            if (line.match(/^\d+:/)) {
              totalMatches++
              parsed.push(`  ${line}`)
            }
          }

          const output = parsed.length > 0 ? parsed.join("\n") : `No matches for: ${params.pattern}`

          return {
            title: `fossil grep: ${params.pattern}`,
            metadata: { matches: totalMatches },
            output,
          }
        }),
    }
  }),
)
