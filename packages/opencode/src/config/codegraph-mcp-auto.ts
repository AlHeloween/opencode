/**
 * Auto-inject mcp.codegraph when missing so hybrid CodeGraph works without
 * hand-editing gitignored opencode.json.
 *
 * - Does not override an existing mcp.codegraph entry (including { enabled: false }).
 * - Opt out: OPENCODE_CODEGRAPH_MCP=0|false
 * - Activates when .codegraph exists and/or resolveCodegraphBin finds the binary (beside the exe, then PATH).
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

/**
 * The ONE codegraph resolver — bootstrap's `codegraph init`, the auto-inject gate and the MCP command all ask it.
 * Beside the running executable first (the installer ships `codegraph.cmd` + `codegraph/` there, not on PATH), then
 * PATH + `Global.Path.bin` via `which`. Plan robot-installer, after B4 (2026-10-07).
 */
export function resolveCodegraphBin(
  env: NodeJS.ProcessEnv = process.env,
  exeDir: string = path.dirname(process.execPath),
): string | null {
  const names = process.platform === "win32" ? ["codegraph.exe", "codegraph.cmd"] : ["codegraph"]
  return names.map((name) => path.join(exeDir, name)).find((file) => existsSync(file)) ?? which("codegraph", env)
}

export function resolveCodegraphCommand(
  env: NodeJS.ProcessEnv = process.env,
  exeDir: string = path.dirname(process.execPath),
): string[] {
  // Local stdio MCP: the spawn (cross-spawn in the MCP SDK) sees the process PATH only, so the command carries the
  // resolved absolute path; an absolute .cmd works through cross-spawn. Unresolved → the bare name, so the spawn
  // error names the missing tool.
  return [resolveCodegraphBin(env, exeDir) ?? "codegraph", "serve", "--mcp"]
}

export function isCodegraphMcpOptOut(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.OPENCODE_CODEGRAPH_MCP ?? "").trim().toLowerCase()
  return v === "0" || v === "false" || v === "off" || v === "no"
}

export function shouldAutoEnableCodegraphMcp(
  worktree: string,
  env: NodeJS.ProcessEnv = process.env,
  exeDir: string = path.dirname(process.execPath),
): boolean {
  if (isCodegraphMcpOptOut(env)) return false
  const cgDir = path.join(worktree, ".codegraph")
  const hasIndex =
    existsSync(path.join(cgDir, "codegraph.db")) || existsSync(cgDir)
  if (hasIndex) return true
  return resolveCodegraphBin(env, exeDir) != null
}

export function defaultCodegraphMcpConfig(
  env: NodeJS.ProcessEnv = process.env,
  exeDir: string = path.dirname(process.execPath),
): ConfigMCP.Info {
  return {
    type: "local",
    command: resolveCodegraphCommand(env, exeDir),
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
  exeDir: string = path.dirname(process.execPath),
): { mcp: McpMap; injected: boolean } {
  const map: McpMap = { ...(mcp ?? {}) }
  if (map.codegraph !== undefined) {
    return { mcp: map, injected: false }
  }
  if (!shouldAutoEnableCodegraphMcp(worktree, env, exeDir)) {
    return { mcp: map, injected: false }
  }
  const codegraph = defaultCodegraphMcpConfig(env, exeDir)
  map.codegraph = codegraph
  log.info("auto-configured mcp.codegraph for hybrid CodeGraph", {
    worktree,
    command: codegraph.type === "local" ? codegraph.command : undefined,
  })
  return { mcp: map, injected: true }
}
