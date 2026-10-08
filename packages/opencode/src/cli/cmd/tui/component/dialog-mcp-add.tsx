import { Keybind } from "@/util/keybind"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { addMcpToConfig, resolveConfigPath } from "@/mcp/config-file"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { DialogContext } from "@tui/ui/dialog"
import type { useSDK } from "@tui/context/sdk"
import type { useToast } from "@tui/ui/toast"
import { buildMcpConfig, validateMcpName, validateMcpUrl, type McpAddInput, type McpOauthChoice } from "./mcp-add-state"

/**
 * The add-connector wizard (plan 2026-10-08_mcps-connector-manager, S4).
 *
 * A sequence on the dialog primitives the rest of the TUI already uses: `DialogPrompt.show`
 * for text steps, `dialog.replace(() => <DialogSelect …/>)` for choice steps (precedents:
 * dialog-settings.tsx, dialog-pipeline.tsx). Persistence goes through the CLI's OWN writer
 * (`@/mcp/config-file`) so the dialog and `opencode mcp add` cannot drift into two spellings
 * of "where an MCP server lives".
 *
 * Live-ness: after the file is written the running server has not re-read it, so the wizard
 * disposes the instance (`POST /instance/dispose` — the same reload `PATCH /config` performs)
 * and only then connects. Attaching a connector changes the tool catalog, hence the request
 * prefix, hence the prompt cache — the effect lands on the NEXT message, and the closing toast
 * says so instead of pretending it is already live.
 */
export async function runMcpAddWizard(props: {
  dialog: DialogContext
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
  existing: readonly string[]
  refresh: () => Promise<void>
  onExit: () => void
}) {
  const { dialog, sdk, toast, existing, refresh, onExit } = props

  /** A choice step: `dialog.replace` a DialogSelect and settle the promise on select/esc. */
  const pick = <T,>(title: string, options: DialogSelectOption<T>[]) =>
    new Promise<T | null>((resolve) => {
      dialog.replace(
        () => <DialogSelect title={title} options={options} onSelect={(option) => resolve(option.value)} />,
        () => resolve(null),
      )
    })

  /** A text step that re-asks until the value validates (ESC cancels). */
  const ask = async (title: string, placeholder: string, validate: (value: string) => string | undefined) => {
    while (true) {
      const value = await DialogPrompt.show(dialog, title, { placeholder })
      if (value === null) return null
      const error = validate(value)
      if (!error) return value.trim()
      toast.show({ message: error, variant: "warning", duration: 4000 })
    }
  }

  // 1 — name
  const name = await ask("Add MCP server — name", "e.g. canva", (value) => validateMcpName(value, existing))
  if (name === null) return onExit()

  // 2 — type
  const type = await pick<"remote" | "local">(`Add "${name}" — type`, [
    { title: "Remote URL", value: "remote", description: "Connect to a remote MCP server over HTTP" },
    { title: "Local command", value: "local", description: "Run a local MCP server process" },
  ])
  if (type === null) return onExit()

  // 3 — address (URL or command line), 4 — OAuth (remote only)
  let input: McpAddInput
  if (type === "remote") {
    const url = await ask(`Add "${name}" — URL`, "https://example.com/mcp", validateMcpUrl)
    if (url === null) return onExit()

    const oauth = await pick<McpOauthChoice>(`Add "${name}" — OAuth`, [
      {
        title: "Auto-detect (recommended)",
        value: "auto",
        description: "Use the server's advertised OAuth; register dynamically if it allows it",
      },
      { title: "Off", value: "off", description: "No OAuth — plain HTTP (writes oauth: false)" },
      {
        title: "Client ID + secret",
        value: "client",
        description: "An existing OAuth app (e.g. the owner's Canva app)",
      },
    ])
    if (oauth === null) return onExit()

    let clientId: string | undefined
    let clientSecret: string | undefined
    if (oauth === "client") {
      const id = await DialogPrompt.show(dialog, `Add "${name}" — OAuth client ID`, { placeholder: "client id" })
      if (id === null) return onExit()
      const secret = await DialogPrompt.show(dialog, `Add "${name}" — OAuth client secret`, { placeholder: "(optional)" })
      if (secret === null) return onExit()
      clientId = id
      clientSecret = secret
    }

    input = { type: "remote", url, oauth, clientId, clientSecret }
  } else {
    const command = await ask(`Add "${name}" — command`, "npx -y @modelcontextprotocol/server-filesystem", (value) =>
      value.trim() ? undefined : "Required",
    )
    if (command === null) return onExit()
    input = { type: "local", command }
  }

  // 5 — scope (real paths, resolved before the choice so the rows name the file they write)
  const worktree = Global.Path.worktree || Global.Path.home
  const [projectPath, globalPath] = await Promise.all([
    resolveConfigPath(worktree, false),
    resolveConfigPath(Global.Path.config, true),
  ])
  const scope = await pick<"project" | "global">(`Add "${name}" — where`, [
    { title: "This project", value: "project", description: projectPath },
    { title: "Global (all projects)", value: "global", description: globalPath },
  ])
  if (scope === null) return onExit()

  // 6 — write → reload → connect → offer auth
  const configPath = scope === "global" ? globalPath : projectPath
  try {
    await addMcpToConfig(name, buildMcpConfig(input), configPath)
    // The file is written; the running server still holds the old config. Dispose the
    // instance so the next Config read rebuilds from disk (the reload PATCH /config does),
    // then connect — connect resolves the server from that freshly-read config.
    await sdk.client.instance.dispose()
    await sdk.client.mcp.connect({ name })
    await refresh()
    toast.show({
      title: "MCP server added",
      message: `${name} → ${configPath} — its tools appear on your next message`,
      variant: "info",
      duration: 6000,
    })

    const status = (await sdk.client.mcp.status()).data?.[name]
    if (status?.status === "needs_auth") {
      const now = await pick<boolean>(`"${name}" needs authentication`, [
        { title: "Authenticate now", value: true, description: "Open the browser for OAuth" },
        { title: "Later", value: false, description: `Run /mcps → ctrl+a on "${name}"` },
      ])
      if (now) {
        dialog.replace(() => (
          <DialogPrompt title={`Authenticating "${name}"`} busy busyText="Waiting for the browser to complete OAuth…" />
        ))
        await sdk.client.mcp.auth.authenticate({ name })
        await refresh()
        toast.show({ title: "MCP authenticated", message: name, variant: "info", duration: 4000 })
      }
    }
  } catch (error) {
    Log.Default.warn("bug: failed to add MCP server", { name, configPath, error: String(error) })
    toast.show({
      title: "Failed to add MCP server",
      message: errorMessage(error),
      variant: "error",
      duration: 8000,
    })
  }
  return onExit()
}

/** Keybind metadata for the wizard entry point — exported so the list footer and the
 * handler cannot drift on the key the user is taught to press. */
export const MCP_ADD_KEYBIND = { keybind: Keybind.parse("ctrl+n")[0], title: "add" } as const
