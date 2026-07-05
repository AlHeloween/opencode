import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { EffectiveNavigation } from "../util/effective-navigation"
import { Truncate } from "@/tool/truncate"
import { useSync } from "@tui/context/sync"
import { existsSync } from "fs"
import path from "path"

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

  const rules = createMemo(() => {
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

  // External directory mode
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
    const next = modes[(idx + 1) % modes.length]
    setExtMode(next)
    // TODO: persist to config
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
          <text fg={theme.textMuted}>click to cycle: ask / allow / deny</text>
        </box>
      </box>

      {/* Allowed Directories */}
      <Show
        when={allowed().length > 0}
        fallback={<text fg={theme.textMuted}>No allowed directories</text>}
      >
        <text fg={theme.success}>Allowed Directories</text>
        <For each={allowed()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={rule.exists ? theme.success : theme.error} wrapMode="word">
                {rule.exists ? "✓" : "✗"} {rule.displayPath}
              </text>
              <text fg={theme.textMuted}>
                ({sourceLabel(rule.source)})
              </text>
            </box>
          )}
        </For>
      </Show>

      {/* Denied Directories */}
      <Show when={denied().length > 0}>
        <text fg={theme.error}>Denied Directories</text>
        <For each={denied()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={rule.exists ? theme.error : theme.textMuted} wrapMode="word">
                ✕ {rule.displayPath}
              </text>
              <text fg={theme.textMuted}>
                ({sourceLabel(rule.source)})
              </text>
            </box>
          )}
        </For>
      </Show>

      {/* Help */}
      <box gap={1}>
        <box>
          <text fg={theme.textMuted}>Use </text>
          <text fg={theme.info}>opencode dirs allow/deny &lt;path&gt;</text>
          <text fg={theme.textMuted}> to configure directories.</text>
        </box>
        <box>
          <text fg={theme.textMuted}>Config: </text>
          <text fg={theme.info}>external_directory_mode</text>
          <text fg={theme.textMuted}>: "deny" | "ask" | "allow"</text>
        </box>
      </box>

      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          Close
        </text>
      </box>
    </box>
  )
}
