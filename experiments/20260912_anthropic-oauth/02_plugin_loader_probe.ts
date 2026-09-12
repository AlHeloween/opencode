/**
 * Post-change live oracle: exercise the actual AnthropicAuthPlugin loader.
 *
 * The credential stays in OMP's encrypted local database; this script reads it
 * without printing it. The minimal PluginInput is intentionally used only
 * because the loader consumes `client.auth.set` and no other PluginInput field.
 *
 *   bun run experiments/20260912_anthropic-oauth/02_plugin_loader_probe.ts
 */
import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { AnthropicAuthPlugin } from "../../packages/opencode/src/plugin/anthropic"

const db = new Database(path.join(os.homedir(), ".omp", "agent", "agent.db"), { readonly: true })
const row = db
  .query<{ data: string }, []>(
    "select data from auth_credentials where provider = 'anthropic' and credential_type = 'oauth' limit 1",
  )
  .get()
if (!row) throw new Error("no OMP Anthropic OAuth credential available for the live oracle")

const decoded = JSON.parse(row.data)
if (
  !decoded ||
  typeof decoded !== "object" ||
  !("refresh" in decoded) ||
  !("access" in decoded) ||
  !("expires" in decoded) ||
  typeof decoded.refresh !== "string" ||
  typeof decoded.access !== "string" ||
  typeof decoded.expires !== "number"
) {
  throw new Error("OMP Anthropic OAuth credential has an invalid shape")
}
const stored = { refresh: decoded.refresh, access: decoded.access, expires: decoded.expires }
if (stored.expires <= Date.now()) {
  throw new Error("OMP OAuth access token is expired; re-login in OMP before this non-persisting live probe")
}
let writes = 0
const pluginInput = {
  client: {
    auth: {
      set: async () => {
        writes++
      },
    },
  },
} as unknown as PluginInput // Loader only reads client.auth.set; full PluginInput is a server construction concern.

const hooks = await AnthropicAuthPlugin(pluginInput)
if (!hooks.auth?.loader) throw new Error("AnthropicAuthPlugin did not expose an auth loader")
const options = await hooks.auth.loader(async () => ({ type: "oauth", ...stored }))
if (typeof options.fetch !== "function") throw new Error("OAuth loader did not provide a fetch override")

const response = await options.fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": "opencode-oauth-dummy-key" },
  body: JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 16,
    messages: [{ role: "user", content: [{ type: "text", text: "Reply with the single word: pong" }] }],
  }),
})
const body = await response.text()
console.log({
  status: response.status,
  refreshed: writes > 0,
  response: body.slice(0, 240),
})
if (!response.ok) process.exit(1)
