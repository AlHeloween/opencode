import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useTuiConfig } from "@tui/context/tui-config"
import { useKeybind } from "@tui/context/keybind"
import { useKeyboard } from "@opentui/solid"
import { For, Show } from "solid-js"

type SettingRow = {
  label: string
  value: string
  muted?: boolean
}

export function DialogTuiConfig() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      dialog.clear()
    }
  })

  const rows = (): SettingRow[] => {
    const r: SettingRow[] = [
      { label: "Theme", value: config.theme ?? "default" },
      { label: "Scroll speed", value: String(config.scroll_speed ?? 3) },
      {
        label: "Scroll acceleration",
        value: config.scroll_acceleration?.enabled ? "enabled" : "disabled",
      },
      { label: "Diff style", value: config.diff_style ?? "auto" },
      { label: "Mouse capture", value: config.mouse ?? true ? "enabled" : "disabled" },
      { label: "Image protocol", value: config.image_protocol ?? "auto" },
    ]

    if (config.keybinds) {
      const leader = keybind.print("leader") ?? "ctrl+x"
      r.push({ label: "Leader key", value: leader })
    }

    return r
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          TUI Settings
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>
      <box paddingTop={1}>
        <text fg={theme.textMuted}>Loaded from tui.json</text>
      </box>
      <Show when={rows().length > 0}>
        <box gap={0}>
          <For each={rows()}>
            {(row) => (
              <box flexDirection="row" gap={2}>
                <text fg={row.muted ? theme.textMuted : theme.text} style={{ width: 22 }}>
                  {row.label}
                </text>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {row.value}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
