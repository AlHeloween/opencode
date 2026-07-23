import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import { hasCodegraphIndex, mcpTouchQueryThenSqlitePack } from "@/codegraph/mcp-client"
import DESCRIPTION from "./codegraph.txt"

// ——— CodeGraph tool — hybrid: MCP touch (refresh) → SQLite pack (low noise).
//     MCP down → hard-fail. Agent sees packed structure, not MCP prose.
// ———

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      "Question, symbol name, or file path(s). Prefer including paths when known for tighter SQLite packs.",
  }),
  mode: Schema.optional(Mode).annotate({
    description: "MCP touch mode (default: explore). Output is always SQLite-packed after MCP.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Project subdirectory / projectPath scope.",
  }),
  depth: Schema.optional(Schema.Number).annotate({
    description: "Traversal depth for impact/trace MCP touch (default server-side).",
  }),
})

type Metadata = {
  resultCount: number
  mode: string
  hasCodegraph: boolean
  via: "mcp+sqlite"
  packedFiles: number
  symbols: number
  crossFileEdges: number
}

export const CodeGraphTool = Tool.define(
  "codegraph",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
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
        const mode = params.mode ?? "explore"
        const projectRoot = ins.worktree
        yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })

        if (!hasCodegraphIndex(projectRoot)) {
          const meta: Metadata = {
            resultCount: 0,
            mode,
            hasCodegraph: false,
            via: "mcp+sqlite",
            packedFiles: 0,
            symbols: 0,
            crossFileEdges: 0,
          }
          return {
            title: "CodeGraph not initialized",
            metadata: meta,
            output:
              `No .codegraph/ index in "${projectRoot}".\n` +
              `Run: codegraph init\n` +
              `Then ensure mcp.codegraph is configured (codegraph serve --mcp).\n` +
              `Hybrid path: MCP touch → SQLite pack. Soft-skip forbidden.`,
          }
        }

        const hybrid = yield* mcpTouchQueryThenSqlitePack(projectRoot, mode, params.query, {
          path: params.path,
          depth: params.depth,
        }).pipe(
          Effect.mapError((err) => {
            const message = err instanceof Error ? err.message : String(err)
            return new Error(
              [
                "CodeGraph hybrid (MCP→SQLite) failed (hard-fail — soft-skip forbidden).",
                message,
                "Fix: mcp.codegraph → codegraph serve --mcp. MCP must refresh before SQLite pack.",
              ].join(" "),
            )
          }),
          Effect.orDie,
        )

        const meta: Metadata = {
          resultCount: hybrid.pack.symbols.length + hybrid.pack.crossFileEdges.length,
          mode,
          hasCodegraph: true,
          via: "mcp+sqlite",
          packedFiles: hybrid.files.length,
          symbols: hybrid.pack.symbols.length,
          crossFileEdges: hybrid.pack.crossFileEdges.length,
        }
        return {
          title: `CodeGraph pack: ${params.query.slice(0, 50)}`,
          metadata: meta,
          output: hybrid.markdown,
        }
      }).pipe(Effect.orDie),
  }),
)

export * as CodeGraph from "./codegraph"
