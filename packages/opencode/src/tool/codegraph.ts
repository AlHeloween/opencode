import { Effect, Schema } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import * as Log from "@opencode-ai/core/util/log"
import { spawnSync } from "child_process"
import { which } from "@/util/which"

import DESCRIPTION from "./codegraph.txt"

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      "Natural language question or symbol name(s) to search for. Include file paths, class names, function names for best results.",
  }),
  mode: Schema.optional(Mode).annotate({
    description:
      "Analysis mode: 'explore' (default — comprehensive context with source code), 'search' (FTS symbol search), 'trace' (caller/callee graph from a symbol), 'impact' (blast radius), 'path' (find shortest path between two symbols using '->' in query e.g. 'Class.method -> Other.func')",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Project subdirectory to scope the query to. Defaults to current working directory.",
  }),
  depth: Schema.optional(Schema.Number).annotate({
    description: "Traversal depth for trace/impact modes (default: 2).",
  }),
})

type Metadata = {
  resultCount: number
  mode: string
  nodeCount: number
  edgeCount: number
  hasCodegraph: boolean
}

// Resolve codegraph binary via which() — checks PATH and Global.Path.bin
let cgBin: string | null | undefined = undefined

function getCgBin(): string | null {
  if (cgBin !== undefined) return cgBin
  cgBin = which("codegraph")
  return cgBin
}

function cgExec(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const bin = getCgBin()
  if (!bin) return { code: -1, stdout: "", stderr: "codegraph binary not found" }
  const result = spawnSync(bin, args, { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
  return { code: result.status ?? -1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" }
}

export const CodeGraphTool = Tool.define(
  "codegraph",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "codegraph",
            patterns: [params.query],
            always: ["*"],
            metadata: { query: params.query, mode: params.mode, depth: params.depth, path: params.path },
          })

          const ins = yield* InstanceState.context
          const projectRoot = params.path
            ? (path.isAbsolute(params.path) ? params.path : path.resolve(ins.directory, params.path))
            : ins.worktree

          yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })

          const mode = params.mode ?? "explore"
          const depth = params.depth ?? 2

          if (!getCgBin()) {
            return {
              title: "CodeGraph not available",
              metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: false },
              output: [
                "CodeGraph CLI not found on PATH or in binary cache.",
                "",
                "Install it: npm i -g @colbymchenry/codegraph",
                "Or the bootstrap will auto-install it to the cache.",
              ].join("\n"),
            }
          }

          // Check if project is indexed
          const status = cgExec(["status", "--json"], projectRoot)
          if (status.code !== 0) {
            return {
              title: "CodeGraph not initialized",
              metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: true },
              output: [
                `CodeGraph is installed but not initialized in "${projectRoot}".`,
                "", "Run: codegraph init", "Or restart opencode to auto-initialize.",
              ].join("\n"),
            }
          }

          // Build CLI args by mode
          let result: ReturnType<typeof cgExec>
          switch (mode) {
            case "search":
              result = cgExec(["query", params.query], projectRoot)
              break
            case "trace":
              result = cgExec(["explore", params.query, "--", "callers", String(depth), "callees", String(depth)], projectRoot)
              break
            case "impact":
              result = cgExec(["explore", params.query, "--", "impact", String(depth)], projectRoot)
              break
            case "path": {
              const parts = params.query.split("->").map((s) => s.trim())
              result = parts.length >= 2
                ? cgExec(["explore", parts[0], "--to", parts[1]], projectRoot)
                : { code: 0, stdout: 'Path mode requires "from -> to" syntax.', stderr: "" }
              break
            }
            default:
              result = cgExec(["explore", params.query], projectRoot)
          }

          return {
            title: `CodeGraph: ${params.query.slice(0, 60)}`,
            metadata: { resultCount: 1, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: true },
            output: result.code === 0 ? result.stdout : result.stderr || "CodeGraph query failed",
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as CodeGraph from "./codegraph"
