/**
 * Auto-inject mcp.codegraph when missing so hybrid CodeGraph works without
 * hand-editing gitignored opencode.json.
 *
 * - Does not override an existing mcp.codegraph entry (including { enabled: false }).
 * - Opt out: OPENCODE_CODEGRAPH_MCP=0|false
 * - Activates when .codegraph exists and/or codegraph binary is resolvable.
 */
import { existsSync } from "fs"
import path from "path"
import { which } from "@/util/which"
import * as Log from "@opencode-ai/core/util/log"
import type { ConfigMCP } from "./mcp"

const log = Log.create({ service: "config.codegraph-mcp-auto" })

export const DEFAULT_CODEGRAPH_MCP_TOOLS =
  "explore,search,callers,callees,impact,node,files,status"

export type McpMap = Record<string, ConfigMCP.Info | { enabled: boolean }>

export function resolveCodegraphCommand(): string[] {
  // Local stdio MCP: command is looked up via PATH (includes Global.Path.bin).
  // Prefer bare "codegraph" so Windows .cmd wrappers work through spawn.
  return ["codegraph", "serve", "--mcp"]
}

export function isCodegraphMcpOptOut(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.OPENCODE_CODEGRAPH_MCP ?? "").trim().toLowerCase()
  return v === "0" || v === "false" || v === "off" || v === "no"
}

export function shouldAutoEnableCodegraphMcp(
  worktree: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isCodegraphMcpOptOut(env)) return false
  const cgDir = path.join(worktree, ".codegraph")
  const hasIndex =
    existsSync(path.join(cgDir, "codegraph.db")) || existsSync(cgDir)
  if (hasIndex) return true
  return which("codegraph", env) != null
}

export function defaultCodegraphMcpConfig(): ConfigMCP.Info {
  return {
    type: "local",
    command: resolveCodegraphCommand(),
    enabled: true,
    timeout: 120_000,
    environment: {
      CODEGRAPH_MCP_TOOLS: DEFAULT_CODEGRAPH_MCP_TOOLS,
    },
  }
}

/**
 * Mutates `mcp` map in place: inject codegraph if absent and eligible.
 * Returns true if injected.
 */
export function injectAutoCodegraphMcp(
  mcp: McpMap | undefined,
  worktree: string,
  env: NodeJS.ProcessEnv = process.env,
): { mcp: McpMap; injected: boolean } {
  const map: McpMap = { ...(mcp ?? {}) }
  if (map.codegraph !== undefined) {
    return { mcp: map, injected: false }
  }
  if (!shouldAutoEnableCodegraphMcp(worktree, env)) {
    return { mcp: map, injected: false }
  }
  map.codegraph = defaultCodegraphMcpConfig()
  log.info("auto-configured mcp.codegraph for hybrid CodeGraph", {
    worktree,
    command: resolveCodegraphCommand(),
  })
  return { mcp: map, injected: true }
}
