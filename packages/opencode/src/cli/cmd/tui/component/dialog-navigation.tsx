import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { For, Show, createMemo, createSignal } from "solid-js"
import { EffectiveNavigation } from "../util/effective-navigation"
import { Truncate } from "@/tool/truncate"
import { useSync } from "@tui/context/sync"
import { existsSync } from "fs"
import path from "path"
import { useSDK } from "@tui/context/sdk"

type ExternalDirMode = "deny" | "ask" | "allow"

function sourceLabel(source: string) {
  switch (source) {
    case "config-allow": return "config"
    case "config-deny": return "denied"
    case "config-permission": return "perm"
    case "auto": return "auto"
    default: return source
  }
}

export function DialogPermissions() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()

  const [addPath, setAddPath] = createSignal("")
  const [addMode, setAddMode] = createSignal<"allow" | "deny">("allow")
  const [refresh, setRefresh] = createSignal(0)

  const rules = createMemo(() => {
    refresh() // trigger reactivity
    try {
      const config = sync.data.config as any
      const autoGlobs = [Truncate.truncateGlob()]
      const collected = EffectiveNavigation.collectNavigationRules(config, autoGlobs)
      const deduped = EffectiveNavigation.deduplicateRules(collected)
      return deduped.map((r) => ({
        action: r.action,
        displayPath: String(r.displayPath),
        source: String(r.source),
        exists: existsSync(String(r.displayPath).replace(/\*$/, "")),
      }))
    } catch {
      return []
    }
  })

  const allowed = createMemo(() => rules().filter((r) => r.action === "allow"))
  const denied = createMemo(() => rules().filter((r) => r.action === "deny"))

  const config = sync.data.config as any
  const [extMode, setExtMode] = createSignal<ExternalDirMode>(
    (config?.external_directory_mode as ExternalDirMode) || "ask"
  )

  const modeLabel = (m: ExternalDirMode) => {
    switch (m) {
      case "deny": return "Deny All"
      case "ask": return "Ask"
      case "allow": return "Allow All"
    }
  }

  const modeColor = (m: ExternalDirMode) => {
    switch (m) {
      case "deny": return theme.error
      case "ask": return theme.warning
      case "allow": return theme.success
    }
  }

  const cycleMode = () => {
    const modes: ExternalDirMode[] = ["ask", "allow", "deny"]
    const idx = modes.indexOf(extMode())
    setExtMode(modes[(idx + 1) % modes.length])
  }

  const addDirectory = async () => {
    const p = addPath().trim()
    if (!p) return
    const resolved = path.resolve(p)
    const action = addMode()
    const nav = { ...(sync.data.config as any).navigation }
    const list = [...(nav[action] ?? [])]
    if (list.some((d: string) => path.resolve(d) === resolved)) return
    list.push(p)
    nav[action] = list
    await sdk.client.config.update({ navigation: nav } as any)
    setAddPath("")
    setRefresh((r) => r + 1)
  }

  const removeDirectory = async (displayPath: string, action: string) => {
    const resolved = path.resolve(displayPath)
    const nav = { ...(sync.data.config as any).navigation }
    const list = [...(nav[action] ?? [])]
    const idx = list.findIndex((d: string) => path.resolve(d) === resolved)
    if (idx >= 0) list.splice(idx, 1)
    nav[action] = list.length > 0 ? list : undefined
    await sdk.client.config.update({ navigation: nav } as any)
    setRefresh((r) => r + 1)
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Permissions
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      {/* External Directory Mode */}
      <box gap={0}>
        <text fg={theme.textMuted}>External Directory Access</text>
        <box flexDirection="row" gap={1} paddingTop={0}>
          <text
            fg={modeColor(extMode())}
            attributes={TextAttributes.BOLD}
            onMouseUp={cycleMode}
          >
            [{modeLabel(extMode())}]
          </text>
          <text fg={theme.textMuted}>click to cycle</text>
        </box>
      </box>

      {/* Add Directory */}
      <box gap={0}>
        <text fg={theme.textMuted}>Add Directory</text>
        <box flexDirection="row" gap={1}>
          <text
            fg={addMode() === "allow" ? theme.success : theme.error}
            onMouseUp={() => setAddMode(addMode() === "allow" ? "deny" : "allow")}
          >
            [{addMode()}]
          </text>
          <text fg={theme.text} wrapMode="word">
            {addPath() || "type path..."}
          </text>
          <text fg={theme.info} onMouseUp={addDirectory}>
            + Add
          </text>
        </box>
      </box>

      {/* Allowed Directories */}
      <Show
        when={allowed().length > 0}
        fallback={<text fg={theme.textMuted}>No allowed directories</text>}
      >
        <text fg={theme.success}>Allowed</text>
        <For each={allowed()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={rule.exists ? theme.success : theme.error} wrapMode="word">
                {rule.exists ? "✓" : "✗"} {rule.displayPath}
              </text>
              <text fg={theme.textMuted}>({sourceLabel(rule.source)})</text>
              {rule.source === "config-allow" && (
                <text
                  fg={theme.error}
                  onMouseUp={() => removeDirectory(rule.displayPath, "allow")}
                >
                  ✕
                </text>
              )}
            </box>
          )}
        </For>
      </Show>

      {/* Denied Directories */}
      <Show when={denied().length > 0}>
        <text fg={theme.error}>Denied</text>
        <For each={denied()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={rule.exists ? theme.error : theme.textMuted} wrapMode="word">
                ✕ {rule.displayPath}
              </text>
              <text fg={theme.textMuted}>({sourceLabel(rule.source)})</text>
              {rule.source === "config-deny" && (
                <text
                  fg={theme.success}
                  onMouseUp={() => removeDirectory(rule.displayPath, "deny")}
                >
                  ↩
                </text>
              )}
            </box>
          )}
        </For>
      </Show>

      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          Close
        </text>
      </box>
    </box>
  )
}
