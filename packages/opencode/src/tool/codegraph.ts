import { Effect, Schema } from "effect"
import path from "path"
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
  nodeCount: number
  edgeCount: number
  hasCodegraph: boolean
}

// Lazy CodeGraph loader — never crashes at startup. If the import fails (e.g. in
// a compiled binary where require.resolve() in npm-sdk.js won't work), the tool
// gracefully reports "not available" instead of taking down the whole application.
let cgLoadAttempted = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cgModule: any = null

async function ensureCodeGraph(): Promise<any> {
  if (cgLoadAttempted) return cgModule
  cgLoadAttempted = true

  try {
    // Try direct platform bundle import
    const target = `${process.platform}-${process.arch}`
    cgModule = await import(/* @vite-ignore */ `@colbymchenry/codegraph-${target}/lib/dist/index.js`)
    return cgModule
  } catch {
    try {
      cgModule = await import("@colbymchenry/codegraph")
      return cgModule
    } catch {
      try {
        const os = await import("os")
        const fs = await import("fs")
        const pjPath = require.resolve("@colbymchenry/codegraph/package.json")
        const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"))
        const target = `${process.platform}-${process.arch}`
        const base = process.env.CODEGRAPH_INSTALL_DIR || path.join(os.homedir(), ".codegraph")
        const lib = path.join(base, "bundles", `${target}-${pj.version}`, "lib", "dist", "index.js")
        if (fs.existsSync(lib)) {
          cgModule = await import(/* @vite-ignore */ lib)
          return cgModule
        }
      } catch {
        // Exhausted
      }
      Log.Default.debug("codegraph: not available — install @colbymchenry/codegraph to enable the codegraph tool")
      return null
    }
  }
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

          // Lazy load CodeGraph
          const CgModule = yield* Effect.promise(() => ensureCodeGraph())
          if (!CgModule) {
            return {
              title: "CodeGraph not available",
              metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: false },
              output: [
                "CodeGraph is not available. To enable the codegraph tool:",
                "",
                "  1. Install the dependency in the project:",
                `     bun add @colbymchenry/codegraph`,
                "",
                "  2. Initialize the index in your project root:",
                "     codegraph init",
                "",
                "CodeGraph provides a pre-indexed knowledge graph of every symbol,",
                "call edge, and dependency — one tool call replaces multiple grep + Read loops.",
              ].join("\n"),
            }
          }

          if (!CgModule.CodeGraph.isInitialized(projectRoot)) {
            return {
              title: "CodeGraph not initialized",
              metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: true },
              output: [
                `CodeGraph is installed but not initialized in "${projectRoot}".`,
                "",
                "Run `codegraph init` to build the index.",
                "Once initialized, codegraph_explore gives you instant structural answers.",
              ].join("\n"),
            }
          }

          // Open the graph (read-only, auto-sync)
          const cg: any = yield* Effect.tryPromise({
            try: () => CgModule.CodeGraph.open(projectRoot, { sync: true, readOnly: true }),
            catch: (err) => new Error(`Failed to open CodeGraph: ${err}`),
          })

          try {
            let output: string
            let nodeCount = 0
            let edgeCount = 0

            switch (mode) {
              case "search":
                output = yield* searchMode(cg, params.query)
                break
              case "trace":
                output = yield* traceMode(cg, params.query, depth)
                break
              case "impact":
                output = yield* impactMode(cg, params.query, depth)
                break
              case "path":
                output = yield* pathMode(cg, params.query)
                break
              default: // explore
                output = yield* exploreMode(cg, params.query, depth)
            }

            const stats = cg.getStats?.()
            if (stats) {
              nodeCount = stats.nodeCount ?? 0
              edgeCount = stats.edgeCount ?? 0
            }

            return {
              title: `CodeGraph: ${params.query.slice(0, 60)}`,
              metadata: { resultCount: 1, mode, nodeCount, edgeCount, hasCodegraph: true },
              output,
            }
          } finally {
            cg.close()
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// === Mode implementations using `any` type for the cg instance ===
// The CodeGraph class has a private constructor so InstanceType can't be used.
// All methods are duck-typed from the library's public API.

function searchMode(cg: any, query: string): Effect.Effect<string> {
  return Effect.sync(() => {
    const results = cg.searchNodes(query, { limit: 30 })
    if (!results || results.length === 0) return "No symbols found."

    const lines: string[] = [`Found ${results.length} symbol(s):`, ""]
    for (const r of results) {
      const n = r.node
      lines.push(`- ${n.name} (${n.kind}) — ${n.filePath}:${n.startLine}`)
    }
    if (results.length > 30) {
      lines.push("", `(Showing first 30 of ${results.length} results)`)
    }
    return lines.join("\n")
  })
}

function traceMode(cg: any, query: string, depth: number): Effect.Effect<string> {
  return Effect.sync(() => {
    const results = cg.searchNodes(query, { limit: 5 })
    if (!results || results.length === 0) return `No symbols found matching "${query}".`

    const lines: string[] = []
    for (const r of results.slice(0, 3)) {
      const n = r.node
      lines.push(`## ${n.name} (${n.kind}) — ${n.filePath}:${n.startLine}`)

      const callers = cg.getCallers(n.id, depth)
      if (callers?.length > 0) {
        lines.push("", `### Called by (${callers.length})`)
        for (const c of callers.slice(0, 10)) {
          lines.push(`- ${c.node.name} (${c.node.kind}) — ${c.node.filePath}:${c.node.startLine}`)
        }
      }

      const callees = cg.getCallees(n.id, depth)
      if (callees?.length > 0) {
        lines.push("", `### Calls (${callees.length})`)
        for (const c of callees.slice(0, 10)) {
          lines.push(`- ${c.node.name} (${c.node.kind}) — ${c.node.filePath}:${c.node.startLine}`)
        }
      }
      lines.push("")
    }
    return lines.join("\n")
  })
}

function impactMode(cg: any, query: string, depth: number): Effect.Effect<string> {
  return Effect.sync(() => {
    const results = cg.searchNodes(query, { limit: 5 })
    if (!results || results.length === 0) return `No symbols found matching "${query}".`

    const sym = results[0].node
    const subgraph = cg.getImpactRadius(sym.id, depth)
    const nodes = subgraph?.nodes ? [...subgraph.nodes.values()] : []
    const edges = subgraph?.edges ?? []

    const lines: string[] = [
      `## Impact radius: ${sym.name} (${sym.kind})`,
      `  File: ${sym.filePath}:${sym.startLine}`,
      "",
      `**${nodes.length} nodes** affected, **${edges.length} edges**`,
    ]
    if (nodes.length > 0) {
      lines.push("", "### Affected symbols")
      for (const n of nodes.slice(0, 20)) {
        lines.push(`- ${n.name} (${n.kind}) — ${n.filePath}:${n.startLine}`)
      }
    }
    return lines.join("\n")
  })
}

function pathMode(cg: any, query: string): Effect.Effect<string> {
  return Effect.sync(() => {
    const parts = query.split("->").map((s) => s.trim())
    if (parts.length < 2) {
      return 'Path mode requires "from -> to" syntax. Example: "Class.method -> Other.func"'
    }

    const [fromQ, toQ] = parts
    const fromResults = cg.searchNodes(fromQ, { limit: 3 })
    const toResults = cg.searchNodes(toQ, { limit: 3 })

    if (!fromResults?.length || !toResults?.length) {
      return ["Could not find symbols.",
        fromResults?.length ? "" : `  From "${fromQ}": not found`,
        toResults?.length ? "" : `  To "${toQ}": not found`,
      ].filter(Boolean).join("\n")
    }

    const fromNode = fromResults[0].node
    const toNode = toResults[0].node
    const pathResult = cg.findPath(fromNode.id, toNode.id)

    if (!pathResult) {
      return [
        `No path found between "${fromNode.name}" and "${toNode.name}".`,
        `  They may not be connected in the call graph.`,
      ].join("\n")
    }

    const lines: string[] = [
      `## Path: ${fromNode.name} \u2192 ${toNode.name}`,
      `  (${pathResult.length} hops)`,
      "",
    ]
    for (const hop of pathResult) {
      if (hop.node) {
        lines.push(`  \u2192 ${hop.node.name} (${hop.node.kind}) — ${hop.node.filePath}:${hop.node.startLine}`)
      }
    }
    return lines.join("\n")
  })
}

function exploreMode(cg: any, query: string, depth: number): Effect.Effect<string> {
  return Effect.promise(async () => {
    const context = await cg.buildContext(query, {
      maxNodes: 30,
      includeCode: true,
      format: "markdown",
      maxCallers: depth,
      maxCallees: depth,
    })
    return typeof context === "string" ? context : JSON.stringify(context, null, 2)
  })
}

export * as CodeGraph from "./codegraph"
