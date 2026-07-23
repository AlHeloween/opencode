import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import { hasCodegraphIndex, modeToMcpCall, callCodegraphMcpOptionalRuntime } from "@/codegraph/mcp-client"
import DESCRIPTION from "./codegraph.txt"

// ——— CodeGraph tool — MCP only.
//     When MCP is active, SQLite and CLI are blocked by CodeGraph.
//     Soft-fail is forbidden: MCP down → hard error (no empty "success").
// ———

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Natural language question or symbol name(s) to search for." }),
  mode: Schema.optional(Mode).annotate({ description: "Analysis mode (default: explore). Mapped to CodeGraph MCP tools." }),
  path: Schema.optional(Schema.String).annotate({ description: "Project subdirectory / projectPath for MCP tools." }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Traversal depth for impact/trace (default server-side)." }),
})

type Metadata = { resultCount: number; mode: string; hasCodegraph: boolean; via: "mcp" }

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
          const meta: Metadata = { resultCount: 0, mode, hasCodegraph: false, via: "mcp" }
          return {
            title: "CodeGraph not initialized",
            metadata: meta,
            output:
              `No .codegraph/ index in "${projectRoot}".\n` +
              `Run: codegraph init\n` +
              `Then ensure mcp.codegraph is configured (codegraph serve --mcp) and reconnect.\n` +
              `Do not use SQLite/CLI while MCP owns the graph; reindex without MCP ~20m.`,
          }
        }

        const { tool, args } = modeToMcpCall(mode, params.query, {
          path: params.path ?? projectRoot,
          depth: params.depth,
        })
        const callArgs = {
          ...args,
          projectPath: (args.projectPath as string) ?? projectRoot,
        }

        // Hard-fail via orDie: MCP down must not become a soft empty success.
        const output = yield* callCodegraphMcpOptionalRuntime(tool, callArgs).pipe(
          Effect.mapError((err) => {
            const message = err instanceof Error ? err.message : String(err)
            return new Error(
              [
                "CodeGraph MCP call failed (hard-fail — soft-skip forbidden).",
                message,
                "Fix: mcp.codegraph enabled → codegraph serve --mcp; CODEGRAPH_MCP_TOOLS as needed.",
                "While MCP is active, SQLite and CLI are blocked. Without MCP, reindex ~20m — not a fallback.",
              ].join(" "),
            )
          }),
          Effect.orDie,
        )

        const meta: Metadata = {
          resultCount: output.split("\n").filter((l) => l.trim()).length,
          mode,
          hasCodegraph: true,
          via: "mcp",
        }
        return {
          title: `CodeGraph ${mode}: ${params.query.slice(0, 60)}`,
          metadata: meta,
          output,
        }
      }).pipe(Effect.orDie),
  }),
)

export * as CodeGraph from "./codegraph"
