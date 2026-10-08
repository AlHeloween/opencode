import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { describeMcpStatus } from "./mcp-dialog-state"
import { useDialog } from "@tui/ui/dialog"
import { MCP_ADD_KEYBIND, runMcpAddWizard } from "./dialog-mcp-add"

export function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}


export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const refresh = async () => {
    // Refresh MCP status from server
    const status = await sdk.client.mcp.status()
    if (status.data) {
      sync.set("mcp", status.data)
    } else {
      Log.Default.warn("bug: MCP status returned no data")
    }
  }

  /** One writer for every row action: guard overlap, run, refresh, report. */
  const run = async (action: string, name: string, fn: () => Promise<unknown>) => {
    // Prevent overlapping operations on the same list
    if (loading() !== null) return
    setLoading(name)
    try {
      await fn()
      await refresh()
    } catch (error) {
      Log.Default.warn(`bug: failed to ${action} MCP server`, { name, error: String(error) })
      toast.show({ message: `MCP ${action} failed: ${errorMessage(error)}`, variant: "error" })
    } finally {
      setLoading(null)
    }
  }

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: describeMcpStatus(status),
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
        category: undefined,
      })),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        await run("toggle", option.value, () => local.mcp.toggle(option.value))
      },
    },
    {
      keybind: MCP_ADD_KEYBIND.keybind,
      title: MCP_ADD_KEYBIND.title,
      onTrigger: async () => {
        // The wizard replaces this dialog as it walks its steps; onExit brings the list back.
        await runMcpAddWizard({
          dialog,
          sdk,
          toast,
          existing: Object.keys(sync.data.mcp ?? {}),
          refresh,
          onExit: () => dialog.replace(() => <DialogMcp />),
        })
      },
    },
    {
      keybind: Keybind.parse("ctrl+a")[0],
      title: "authenticate",
      onTrigger: async (option: DialogSelectOption<string>) => {
        // OAuth: the server opens the browser and resolves once the callback lands
        // (mcp/index.ts authenticate()). While it waits, the row shows ⋯ Loading.
        await run("authenticate", option.value, () => sdk.client.mcp.auth.authenticate({ name: option.value }))
      },
    },
    {
      keybind: Keybind.parse("ctrl+r")[0],
      title: "reconnect",
      onTrigger: async (option: DialogSelectOption<string>) => {
        await run("reconnect", option.value, () => sdk.client.mcp.connect({ name: option.value }))
      },
    },
    {
      keybind: Keybind.parse("ctrl+l")[0],
      title: "logout",
      onTrigger: async (option: DialogSelectOption<string>) => {
        await run("logout", option.value, () => sdk.client.mcp.auth.remove({ name: option.value }))
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs — ctrl+n add"
      options={options()}
      keybind={keybinds()}
      onSelect={(_option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
