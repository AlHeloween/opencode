import path from "path"
import { applyEdits, modify } from "jsonc-parser"
import type { ConfigMCP } from "@/config/mcp"
import { Filesystem } from "@/util/filesystem"

/**
 * The ONE writer for the `mcp` entries of an opencode config file.
 *
 * Extracted from `cli/cmd/mcp.ts` (plan 2026-10-08_mcps-connector-manager, S4) so the
 * TUI's add-connector wizard persists through the SAME code path the CLI uses: two
 * spellings of "where does an MCP server live" are how the file and the dialog drift
 * apart. `modify` rewrites only the addressed subtree, so hand-written `//` comments
 * and formatting elsewhere in the file survive (the reason `Config.update` uses the
 * same jsonc-parser primitive).
 */

/** Resolve the config file to write: an existing file wins, otherwise the default name. */
export async function resolveConfigPath(baseDir: string, global = false): Promise<string> {
  // Check for existing config files (prefer .jsonc over .json, check .opencode/ subdirectory too)
  const candidates = [path.join(baseDir, "opencode.json"), path.join(baseDir, "opencode.jsonc")]

  if (!global) {
    candidates.push(path.join(baseDir, ".opencode", "opencode.json"), path.join(baseDir, ".opencode", "opencode.jsonc"))
  }

  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) {
      return candidate
    }
  }

  // Default to opencode.json if none exist
  return candidates[0]
}

/** Merge one MCP server into `mcp.<name>` of the config file, preserving comments. */
export async function addMcpToConfig(name: string, mcpConfig: ConfigMCP.Info, configPath: string): Promise<string> {
  let text = "{}"
  if (await Filesystem.exists(configPath)) {
    text = await Filesystem.readText(configPath)
  }

  // Use jsonc-parser to modify while preserving comments
  const edits = modify(text, ["mcp", name], mcpConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Filesystem.write(configPath, result)

  return configPath
}
