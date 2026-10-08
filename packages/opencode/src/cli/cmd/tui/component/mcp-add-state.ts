import type { ConfigMCP } from "@/config/mcp"

/**
 * Pure logic for the `/mcps` add-connector wizard (plan 2026-10-08_mcps-connector-manager,
 * S4). Kept out of the `.tsx` for the reason `mcp-dialog-state.ts` exists: the rules the
 * user is held to — what a legal server name is, how a typed command line becomes argv,
 * which `oauth` key a choice writes — are pinned by a test instead of living in a render
 * tree. Nothing here touches the network, the dialog or the config file.
 */

/** Letters, digits, `-` and `_` — the spelling that survives as a tool-id prefix and a JSON key. */
export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

/** `undefined` when the name is usable, otherwise the message the prompt shows. */
export function validateMcpName(raw: string, existing: readonly string[] = []): string | undefined {
  const name = raw.trim()
  if (!name) return "Required"
  if (!MCP_NAME_PATTERN.test(name)) return "Use letters, digits, - and _ only"
  if (existing.includes(name)) return `"${name}" already exists`
  return undefined
}

/** `undefined` when the URL parses, otherwise the message the prompt shows. */
export function validateMcpUrl(raw: string): string | undefined {
  const url = raw.trim()
  if (!url) return "Required"
  return URL.canParse(url) ? undefined : "Enter a valid URL (e.g. https://example.com/mcp)"
}

/** Split a typed command line into argv (runs of whitespace collapse; no shell quoting). */
export function parseMcpCommand(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean)
}

/** What the OAuth step chose. `auto` writes nothing; the server auto-detects (incl. DCR). */
export type McpOauthChoice = "auto" | "off" | "client"

export type McpAddInput = {
  type: "remote" | "local"
  url?: string
  command?: string
  oauth?: McpOauthChoice
  clientId?: string
  clientSecret?: string
}

/** Build the `mcp.<name>` value from the wizard's answers. */
export function buildMcpConfig(input: McpAddInput): ConfigMCP.Info {
  if (input.type === "local") {
    return { type: "local", command: parseMcpCommand(input.command ?? "") }
  }

  const url = (input.url ?? "").trim()

  if (input.oauth === "off") return { type: "remote", url, oauth: false }

  if (input.oauth === "client") {
    const clientId = input.clientId?.trim()
    const clientSecret = input.clientSecret?.trim()
    return {
      type: "remote",
      url,
      oauth: { ...(clientId ? { clientId } : {}), ...(clientSecret ? { clientSecret } : {}) },
    }
  }

  // "auto" (the default): write NO `oauth` key — the server auto-detects, incl. DCR (RFC 7591).
  return { type: "remote", url }
}
