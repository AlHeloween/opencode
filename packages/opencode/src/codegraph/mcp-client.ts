/**
 * CodeGraph hybrid: MCP touch (live owner / refresh) → SQLite pack (structure).
 *
 * MCP must run first so the index is fresh. Agent-facing output is the packed
 * SQLite structure (low noise). MCP prose is not returned by default.
 * Soft-fail if MCP is down is forbidden.
 */
import { Effect, Option } from "effect"
import { existsSync } from "fs"
import path from "path"
import { MCP } from "@/mcp"
import { getCodegraphDbPath } from "./reader"
import {
  extractPathsFromText,
  formatPackMarkdown,
  packGraphForFiles,
  packToSymTag,
  type GraphPack,
} from "./sqlite-pack"

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
 * Prefer {@link mcpTouchThenSqlitePack} for agent/fossil (packed, low noise).
 */
export function exploreChangedFilesMcp(
  worktree: string,
  changedFiles: string[],
): Effect.Effect<string, Error> {
  const { tool, args } = exploreArgsForChangedFiles(worktree, changedFiles)
  return callCodegraphMcpOptionalRuntime(tool, args)
}

export type HybridPackResult = {
  pack: GraphPack
  /** Packed markdown for agents (MCP narrative suppressed). */
  markdown: string
  /** Fossil sym tag from SQLite pack. */
  symTag: string
  /** Raw MCP text kept for diagnostics only (not default agent output). */
  mcpText: string
  files: string[]
}

function hybridDebounceMs(override?: number): number {
  if (override != null) return override
  const n = Number(process.env.CODEGRAPH_HYBRID_DEBOUNCE_MS ?? "500")
  return Number.isFinite(n) && n >= 0 ? n : 500
}

/**
 * MCP explore on file list (force live refresh) → debounce → SQLite pack.
 * Hard-fails if MCP is down. Returns packed structure, not MCP prose.
 */
export function mcpTouchThenSqlitePack(
  worktree: string,
  changedFiles: string[],
  opts?: { debounceMs?: number; queryLabel?: string },
): Effect.Effect<HybridPackResult, Error> {
  return Effect.gen(function* () {
    const files = [...new Set(changedFiles.map((f) => f.replace(/\\/g, "/")).filter(Boolean))]
    if (files.length === 0) {
      return yield* Effect.fail(new Error("mcpTouchThenSqlitePack: empty file list"))
    }

    const { tool, args } = exploreArgsForChangedFiles(worktree, files)
    const mcpText = yield* callCodegraphMcpOptionalRuntime(tool, args)

    const wait = hybridDebounceMs(opts?.debounceMs)
    if (wait > 0) {
      yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, wait)))
    }

    const pack = packGraphForFiles(worktree, files)
    const markdown = formatPackMarkdown(pack, {
      query: opts?.queryLabel ?? files.slice(0, 12).join(", "),
    })
    const symTag = packToSymTag(pack)
    return { pack, markdown, symTag, mcpText, files }
  })
}

/**
 * Free-form agent query: MCP touch first, derive file paths, then SQLite pack.
 * Hard-fails if MCP is down. Output markdown is SQLite pack (low noise).
 */
export function mcpTouchQueryThenSqlitePack(
  worktree: string,
  mode: string,
  query: string,
  opts?: { path?: string; depth?: number; debounceMs?: number },
): Effect.Effect<HybridPackResult, Error> {
  return Effect.gen(function* () {
    const { tool, args } = modeToMcpCall(mode, query, {
      path: opts?.path ?? worktree,
      depth: opts?.depth,
    })
    const callArgs = {
      ...args,
      projectPath: (args.projectPath as string) ?? worktree,
    }
    const mcpText = yield* callCodegraphMcpOptionalRuntime(tool, callArgs)

    const wait = hybridDebounceMs(opts?.debounceMs)
    if (wait > 0) {
      yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, wait)))
    }

    let files = extractPathsFromText(mcpText, worktree)
    // If query looks like a path, include it
    const q = query.trim().replace(/\\/g, "/")
    if (/\.(ts|tsx|js|jsx|rs|py)$/i.test(q) && existsSync(path.join(worktree, q))) {
      files = [...new Set([q, ...files])]
    }
    if (opts?.path && !path.extname(opts.path)) {
      // directory scope: keep extracted files under that prefix
      const prefix = opts.path.replace(/\\/g, "/").replace(/\/$/, "")
      files = files.filter((f) => f.startsWith(prefix + "/") || f.startsWith(prefix))
    }

    if (files.length === 0) {
      // Still return empty pack with a clear structured note (MCP did run).
      const pack = packGraphForFiles(worktree, [])
      const markdown = [
        "# CodeGraph pack (MCP-touched → SQLite structure)",
        "",
        `**Query:** ${query}`,
        "",
        "MCP refresh succeeded but no file paths were resolved for SQLite packing.",
        "Re-run with a file path in `query` or `path`, or a more specific symbol.",
        "",
        "_MCP narrative suppressed._",
      ].join("\n")
      return {
        pack,
        markdown,
        symTag: "KINDS:none|TOP:none|XF:0",
        mcpText,
        files: [],
      }
    }

    const pack = packGraphForFiles(worktree, files)
    const markdown = formatPackMarkdown(pack, { query })
    const symTag = packToSymTag(pack)
    return { pack, markdown, symTag, mcpText, files }
  })
}
