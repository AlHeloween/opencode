/**
 * CodeGraph via MCP only.
 *
 * When MCP is active, SQLite and CLI are blocked by CodeGraph. Direct readers
 * and CLI fallbacks are illegal. Soft-fail is forbidden — if MCP is down,
 * operations Effect.fail with an actionable error (reindex without MCP ~20m).
 */
import { Effect, Option } from "effect"
import { existsSync } from "fs"
import path from "path"
import { MCP } from "@/mcp"
import { getCodegraphDbPath } from "./reader"

export const CODEGRAPH_MCP_SERVER = "codegraph"

/** True when the worktree has a CodeGraph index (MCP required for live use). */
export function hasCodegraphIndex(worktree: string): boolean {
  return existsSync(getCodegraphDbPath(worktree)) || existsSync(path.join(worktree, ".codegraph"))
}

/**
 * Call a CodeGraph MCP tool by short name (explore, impact, …) or full
 * codegraph_* name. Tries connect once; hard-fails if still unavailable.
 */
export function callCodegraphMcp(
  tool: string,
  args: Record<string, unknown> = {},
): Effect.Effect<string, Error, MCP.Service> {
  return Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const name = tool.startsWith("codegraph_") ? tool : `codegraph_${tool}`
    return yield* mcp.callTool(CODEGRAPH_MCP_SERVER, name, args)
  })
}

/**
 * Same as callCodegraphMcp but uses serviceOption — fails hard if MCP service
 * is not in the runtime (misconfigured layer), not soft-skip.
 */
export function callCodegraphMcpOptionalRuntime(
  tool: string,
  args: Record<string, unknown> = {},
): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const opt = yield* Effect.serviceOption(MCP.Service)
    if (Option.isNone(opt)) {
      return yield* Effect.fail(
        new Error(
          "MCP.Service is not available in this runtime. CodeGraph requires MCP; " +
            "cannot soft-skip. Run under app runtime with mcp.codegraph configured.",
        ),
      )
    }
    const name = tool.startsWith("codegraph_") ? tool : `codegraph_${tool}`
    return yield* opt.value.callTool(CODEGRAPH_MCP_SERVER, name, args)
  })
}

/** Map built-in codegraph tool modes → MCP tool + args. */
export function modeToMcpCall(
  mode: string,
  query: string,
  opts: { path?: string; depth?: number },
): { tool: string; args: Record<string, unknown> } {
  const pathArg = opts.path ? { projectPath: opts.path, path: opts.path } : {}
  const depthArg = opts.depth != null ? { depth: opts.depth } : {}

  switch (mode) {
    case "search":
      return { tool: "codegraph_search", args: { query, ...pathArg } }
    case "trace":
      return {
        tool: "codegraph_callers",
        args: { symbol: query, query, ...pathArg, ...depthArg },
      }
    case "impact":
      return {
        tool: "codegraph_impact",
        args: { symbol: query, query, ...pathArg, ...depthArg },
      }
    case "path":
      return {
        tool: "codegraph_explore",
        args: { query: `call path: ${query}`, ...pathArg, ...depthArg },
      }
    case "explore":
    default:
      return {
        tool: "codegraph_explore",
        args: { query, ...pathArg, ...depthArg },
      }
  }
}

/** Compact fossil tag text from MCP impact/explore output (bounded). */
export function mcpTextToSymTag(text: string, maxLen = 1500): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) {
    throw new Error("CodeGraph MCP returned empty text — refusing empty sym tag (hard-fail)")
  }
  const body = compact.length > maxLen ? compact.slice(0, maxLen) + "…" : compact
  return `MCP:${body}`
}

/**
 * Build MCP explore args for a fossil (or any) changed-file list.
 * Same query shape as packages/opencode/test/codegraph/mcp_diff_smoke.ts.
 */
export function exploreArgsForChangedFiles(
  worktree: string,
  changedFiles: string[],
  opts?: { maxFiles?: number },
): { tool: string; args: Record<string, unknown> } {
  const max = opts?.maxFiles ?? 40
  const files = changedFiles.slice(0, max)
  const query = [
    "Structural impact of these changed files (symbols, callers, blast radius):",
    ...files,
  ].join("\n")
  return {
    tool: "codegraph_explore",
    args: {
      query,
      projectPath: worktree,
    },
  }
}

/**
 * Live structural text for changed files via MCP explore. Hard-fails if MCP down.
 */
export function exploreChangedFilesMcp(
  worktree: string,
  changedFiles: string[],
): Effect.Effect<string, Error> {
  const { tool, args } = exploreArgsForChangedFiles(worktree, changedFiles)
  return callCodegraphMcpOptionalRuntime(tool, args)
}
