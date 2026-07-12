import { Effect, Schema } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import { spawnSync } from "child_process"
import { which } from "@/util/which"

import DESCRIPTION from "./codegraph.txt"

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Natural language question or symbol name(s) to search for." }),
  mode: Schema.optional(Mode).annotate({ description: "Analysis mode (default: explore)" }),
  path: Schema.optional(Schema.String).annotate({ description: "Project subdirectory to scope the query to." }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Traversal depth (default: 2)." }),
})

type Metadata = { resultCount: number; mode: string; nodeCount: number; edgeCount: number; hasCodegraph: boolean }

let bin: string | null | undefined

function getBin(): string | null {
  if (bin !== undefined) return bin
  bin = which("codegraph")
  return bin
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
          const projectRoot = params.path ? (path.isAbsolute(params.path) ? params.path : path.resolve(ins.directory, params.path)) : ins.worktree
          yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })
          const mode = params.mode ?? "explore"
          const depth = params.depth ?? 2
          const cgBin = getBin()
          if (!cgBin) return { title: "CodeGraph not available", metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: false }, output: "CodeGraph CLI not found. Install: npm i -g @colbymchenry/codegraph" }
          const status = spawnSync(cgBin, ["status", "--json"], { cwd: projectRoot, encoding: "utf-8", timeout: 10000 })
          if (status.status !== 0) return { title: "CodeGraph not initialized", metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: true }, output: `CodeGraph not initialized in "${projectRoot}". Run: codegraph init` }
          const args = buildArgs(mode, params.query, depth)
          const r = spawnSync(cgBin, args, { cwd: projectRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
          return { title: `CodeGraph: ${params.query.slice(0, 60)}`, metadata: { resultCount: 1, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: true }, output: r.status === 0 ? (r.stdout ?? "") : (r.stderr ?? "failed") }
        }).pipe(Effect.orDie),
    }
  }),
)

function buildArgs(mode: string, query: string, depth: number): string[] {
  switch (mode) {
    case "search": return ["query", query]
    case "trace": return ["explore", query, "--callers", String(depth), "--callees", String(depth)]
    case "impact": return ["explore", query, "--impact", String(depth)]
    case "path": { const p = query.split("->").map(s => s.trim()); return p.length >= 2 ? ["explore", p[0], "--to", p[1]] : ["explore", query] }
    default: return ["explore", query]
  }
}

export * as CodeGraph from "./codegraph"
