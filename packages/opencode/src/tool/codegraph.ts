import { Effect, Schema } from "effect"
import path from "path"
import { execFileSync } from "child_process"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import { which } from "@/util/which"

import DESCRIPTION from "./codegraph.txt"

// ——— CodeGraph tool — delegates to the codegraph CLI (installed via npm or
//     the standalone installer). No direct SQLite access — the CLI owns its
//     schema and query semantics, so we never drift from upstream.
// ———

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Natural language question or symbol name(s) to search for." }),
  mode: Schema.optional(Mode).annotate({ description: "Analysis mode (default: explore)." }),
  path: Schema.optional(Schema.String).annotate({ description: "Project subdirectory to scope the query to." }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Traversal depth for trace/impact modes (default: 2)." }),
})

type Metadata = { resultCount: number; mode: string; hasCodegraph: boolean }

/** Resolve the codegraph binary. Mirrors bootstrap.ts: try PATH, then sibling of opencode. */
function findCodegraph(): string | null {
  const bin = which("codegraph")
  if (bin) return bin
  // Check alongside the opencode binary (same directory)
  try {
    const ext = process.platform === "win32" ? ".exe" : ""
    const sibling = path.join(path.dirname(process.execPath), `codegraph${ext}`)
    const { existsSync } = require("fs") as typeof import("fs")
    if (existsSync(sibling)) return sibling
  } catch { /* fall through */ }
  return null
}

/** Run a codegraph CLI command and return its stdout. */
function runCodegraph(args: string[], cwd: string, timeoutMs = 30000): string {
  const cgBin = findCodegraph()
  if (!cgBin) throw new Error("codegraph CLI not found")
  return execFileSync(cgBin, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
}

/** Resolve --path flag value if the user supplied a scoping directory. */
function scopePath(raw: string | undefined, worktree: string): string | undefined {
  if (!raw) return undefined
  return path.isAbsolute(raw) ? raw : path.resolve(worktree, raw)
}

export const CodeGraphTool = Tool.define(
  "codegraph",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "codegraph", patterns: [params.query], always: ["*"], metadata: { query: params.query, mode: params.mode, depth: params.depth, path: params.path } })
          const ins = yield* InstanceState.context
          const mode = params.mode ?? "explore"

          // Always operate from the worktree root — the .codegraph/ database lives there
          const projectRoot = ins.worktree
          yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })

          // Verify the CLI is reachable
          const cgBin = findCodegraph()
          if (!cgBin) return {
            title: "CodeGraph CLI not available",
            metadata: { resultCount: 0, mode, hasCodegraph: false },
            output: `CodeGraph CLI not found. Install with: npm i -g @colbymchenry/codegraph\nOr: irm https://.../install.ps1 | iex`,
          }

          // Verify the project has been indexed
          const { existsSync } = require("fs") as typeof import("fs")
          const dbPath = path.join(projectRoot, ".codegraph", "codegraph.db")
          if (!existsSync(dbPath)) return {
            title: "CodeGraph not initialized",
            metadata: { resultCount: 0, mode, hasCodegraph: false },
            output: `No .codegraph/ index found in "${projectRoot}". Run "codegraph init" to index the project first.`,
          }

          const scope = scopePath(params.path, projectRoot)

          try {
            let output: string
            switch (mode) {
              case "search":
                output = runCodegraph(["query", params.query], projectRoot)
                break
              case "trace": {
                // Combine callers + callees into one trace view
                const callers = runCodegraph(["callers", params.query], projectRoot)
                const callees = runCodegraph(["callees", params.query], projectRoot)
                output = `Trace: ${params.query}\n\n## Callers\n${callers}\n\n## Callees\n${callees}`
                break
              }
              case "impact":
                output = runCodegraph(["impact", params.query], projectRoot)
                break
              case "path": {
                // codegraph explore handles "A -> B" queries natively
                const parts = params.query.split("->").map(s => s.trim())
                const q = parts.length >= 2 ? `"${parts[0]}" -> "${parts[1]}"` : params.query
                output = runCodegraph(scope ? ["explore", "--path", scope, q] : ["explore", q], projectRoot)
                break
              }
              default: { // explore
                output = runCodegraph(scope ? ["explore", "--path", scope, params.query] : ["explore", params.query], projectRoot)
                break
              }
            }

            return {
              title: `CodeGraph ${mode}: ${params.query.slice(0, 60)}`,
              metadata: { resultCount: output.split("\n").filter(l => l.trim()).length, mode, hasCodegraph: true },
              output,
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
              title: `CodeGraph error`,
              metadata: { resultCount: 0, mode, hasCodegraph: true },
              output: `CodeGraph CLI failed: ${message}`,
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as CodeGraph from "./codegraph"
