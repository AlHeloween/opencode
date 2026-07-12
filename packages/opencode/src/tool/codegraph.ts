import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import * as Log from "@opencode-ai/core/util/log"

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
  nodeCount?: number
  edgeCount?: number
  fileCount?: number
  hasCodegraph: boolean
}

export const CodeGraphTool = Tool.define(
  "codegraph",
  Effect.gen(function* () {
    // Lazy import CodeGraph — it's heavy and may not be needed this session
    const CgModule = yield* Effect.promise(async () => import("@colbymchenry/codegraph"))

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
            metadata: {
              query: params.query,
              mode: params.mode,
              depth: params.depth,
              path: params.path,
            },
          })

          const ins = yield* InstanceState.context
          const projectRoot = params.path
            ? (path.isAbsolute(params.path) ? params.path : path.resolve(ins.directory, params.path))
            : ins.worktree

          yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })

          const mode = params.mode ?? "explore"
          const depth = params.depth ?? 2

          // Check if CodeGraph is initialized
          if (!CgModule.CodeGraph.isInitialized(projectRoot)) {
            return {
              title: "CodeGraph not initialized",
              metadata: {
                resultCount: 0,
                mode,
                hasCodegraph: false,
              },
              output: [
                `CodeGraph is not initialized in "${projectRoot}".`,
                "",
                "Run `codegraph init` to build the index, or use this command from the project root.",
                "Once initialized, codegraph_explore gives you instant structural answers from a pre-built knowledge graph.",
              ].join("\n"),
            }
          }

          // Open existing CodeGraph instance
          const cg = yield* Effect.tryPromise({
            try: () => CgModule.CodeGraph.open(projectRoot, { sync: true, readOnly: true }),
            catch: (err) => new Error(`Failed to open CodeGraph: ${err}`),
          })

          try {
            let output: string
            let resultCount = 0
            let nodeCount = 0
            let edgeCount = 0

            switch (mode) {
              case "search": {
                // Full-text search for symbols
                const results = cg.searchNodes(params.query, { limit: 30 })
                resultCount = results.length
                output = formatSearchResults(results, cg)
                break
              }

              case "trace": {
                // Find symbol by name, then get callers + callees
                const symbols = cg.searchNodes(params.query, { limit: 5 })
                if (symbols.length === 0) {
                  output = `No symbols found matching "${params.query}".`
                  break
                }

                const lines: string[] = []
                for (const sym of symbols.slice(0, 3)) {
                  const node = cg.getNode(sym.node_id)
                  if (!node) continue

                  lines.push(`## ${sym.node_name} (${sym.node_kind}) — ${sym.file_path}:${sym.start_line}`)
                  lines.push("")

                  // Get source code
                  const code = yield* Effect.promise(() => cg.getCode(sym.node_id))
                  if (code) {
                    lines.push("```" + inferFiletype(sym.file_path))
                    lines.push(code)
                    lines.push("```")
                    lines.push("")
                  }

                  // Callers (who calls this)
                  const callers = cg.getCallers(sym.node_id, depth)
                  if (callers.length > 0) {
                    lines.push("### Called by (" + callers.length + ")")
                    for (const c of callers.slice(0, 10)) {
                      const callerCode = yield* Effect.promise(() => cg.getCode(c.node.id))
                      const snippet = callerCode
                        ? callerCode.split("\n").slice(0, 3).join("\n")
                        : ""
                      lines.push(`- ${c.node.name} (${c.node.file}:${c.node.start_line})`)
                      if (snippet) {
                        lines.push("  ```" + inferFiletype(c.node.file))
                        lines.push("  " + snippet.split("\n").join("\n  "))
                        lines.push("  ```")
                      }
                    }
                    lines.push("")
                  }

                  // Callees (what this calls)
                  const callees = cg.getCallees(sym.node_id, depth)
                  if (callees.length > 0) {
                    lines.push("### Calls (" + callees.length + ")")
                    for (const c of callees.slice(0, 10)) {
                      const calleeCode = yield* Effect.promise(() => cg.getCode(c.node.id))
                      const snippet = calleeCode
                        ? calleeCode.split("\n").slice(0, 3).join("\n")
                        : ""
                      lines.push(`- ${c.node.name} (${c.node.file}:${c.node.start_line})`)
                      if (snippet) {
                        lines.push("  ```" + inferFiletype(c.node.file))
                        lines.push("  " + snippet.split("\n").join("\n  "))
                        lines.push("  ```")
                      }
                    }
                    lines.push("")
                  }

                  resultCount++
                }

                output = lines.join("\n")
                const stats = cg.getStats()
                nodeCount = stats.nodeCount ?? 0
                edgeCount = stats.edgeCount ?? 0
                break
              }

              case "impact": {
                // Find symbol, then compute impact radius
                const symbols = cg.searchNodes(params.query, { limit: 5 })
                if (symbols.length === 0) {
                  output = `No symbols found matching "${params.query}".`
                  break
                }

                const sym = symbols[0]
                const subgraph = cg.getImpactRadius(sym.node_id, depth)
                const lines: string[] = [
                  `## Impact radius: ${sym.node_name} (${sym.node_kind})`,
                  `  File: ${sym.file_path}:${sym.start_line}`,
                  "",
                ]

                const nodes = subgraph.nodes ?? []
                const edges = subgraph.edges ?? []
                nodeCount = nodes.length
                edgeCount = edges.length
                lines.push(`**${nodeCount} nodes** affected, **${edgeCount} edges**`)

                if (nodes.length > 0) {
                  lines.push("")
                  lines.push("### Affected symbols")
                  for (const n of nodes.slice(0, 20)) {
                    const code = yield* Effect.promise(() => cg.getCode(n.id).catch(() => null))
                    const snippet = code
                      ? code.split("\n").slice(0, 2).join("\n")
                      : ""
                    lines.push(`- ${n.name} (${n.kind}, ${n.file}:${n.start_line})`)
                    if (snippet) {
                      lines.push("  ```" + inferFiletype(n.file))
                      lines.push("  " + snippet.split("\n").join("\n  "))
                      lines.push("  ```")
                    }
                  }
                }

                output = lines.join("\n")
                break
              }

              case "path": {
                // Parse "from -> to" in the query
                const parts = params.query.split("->").map((s) => s.trim())
                if (parts.length < 2) {
                  output = `Path mode requires "from -> to" syntax in the query. Example: "Class.method -> Other.func"`
                  break
                }

                const [fromQ, toQ] = parts
                const fromResults = cg.searchNodes(fromQ, { limit: 3 })
                const toResults = cg.searchNodes(toQ, { limit: 3 })

                if (fromResults.length === 0 || toResults.length === 0) {
                  output = [
                    `Could not find symbols.`,
                    fromResults.length === 0 ? `  From "${fromQ}": not found` : "",
                    toResults.length === 0 ? `  To "${toQ}": not found` : "",
                  ].filter(Boolean).join("\n")
                  break
                }

                const path = cg.findPath(fromResults[0].node_id, toResults[0].node_id)
                if (!path) {
                  output = [
                    `No path found between "${fromResults[0].node_name}" and "${toResults[0].node_name}".`,
                    `  They may not be connected in the call graph.`,
                  ].join("\n")
                  break
                }

                const lines: string[] = [
                  `## Path: ${fromResults[0].node_name} → ${toResults[0].node_name}`,
                  `  (${path.length} hops)`,
                  "",
                ]
                for (const hop of path) {
                  const code = hop.node
                    ? yield* Effect.promise(() => cg.getCode(hop.node.id).catch(() => null))
                    : null
                  const snippet = code
                    ? code.split("\n").slice(0, 2).join("\n")
                    : ""
                  lines.push(`  → ${hop.node?.name ?? "?"} (${hop.node?.file ?? "?"}:${hop.node?.start_line ?? "?"})`)
                  if (snippet) {
                    lines.push("    ```" + inferFiletype(hop.node?.file ?? ""))
                    lines.push("    " + snippet.split("\n").join("\n    "))
                    lines.push("    ```")
                  }
                }

                output = lines.join("\n")
                break
              }

              default: // "explore"
              {
                const context = yield* Effect.promise(() =>
                  cg.buildContext(params.query, {
                    maxNodes: 30,
                    includeCode: true,
                    format: "markdown",
                    maxCallers: depth,
                    maxCallees: depth,
                  }),
                )

                const contextStr = typeof context === "string" ? context : JSON.stringify(context, null, 2)
                output = contextStr
                const stats = cg.getStats()
                nodeCount = stats.nodeCount ?? 0
                edgeCount = stats.edgeCount ?? 0
                resultCount = 1
                break
              }
            }

            return {
              title: `CodeGraph: ${params.query.slice(0, 60)}`,
              metadata: {
                resultCount,
                mode,
                nodeCount,
                edgeCount,
                hasCodegraph: true,
              },
              output,
            }
          } finally {
            cg.close()
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function formatSearchResults(
  results: Array<{ node_id: string; node_name: string; node_kind: string; file_path: string; start_line: number; snippet?: string }>,
  cg: import("@colbymchenry/codegraph").CodeGraph,
): string {
  if (results.length === 0) return "No results found."

  const lines: string[] = [`Found ${results.length} symbol(s):`, ""]
  for (const r of results.slice(0, 30)) {
    lines.push(`- ${r.node_name} (${r.node_kind}) — ${r.file_path}:${r.start_line}`)
    if (r.snippet) {
      lines.push("  ```" + inferFiletype(r.file_path))
      lines.push("  " + r.snippet.split("\n").join("\n  "))
      lines.push("  ```")
    }
  }

  if (results.length > 30) {
    lines.push("", `(Showing first 30 of ${results.length} results)`)
  }

  return lines.join("\n")
}

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  dart: "dart",
  lua: "lua",
  pas: "pascal",
  dpr: "pascal",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  css: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  bat: "batch",
  cmd: "batch",
}

function inferFiletype(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_MAP[ext] ?? ext
}

// Need 'path' for directory resolution
import path from "path"

export * as CodeGraph from "./codegraph"
