import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { For, Show, createMemo } from "solid-js"
import { EffectiveNavigation } from "../util/effective-navigation"
import { Truncate } from "@/tool/truncate"
import { useSync } from "@tui/context/sync"

function sourceLabel(source: string) {
  switch (source) {
    case "config-allow": return "config (allow)"
    case "config-deny": return "config (deny)"
    case "config-permission": return "config (perm)"
    case "auto": return "auto"
    default: return source
  }
}

export function DialogNavigation() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()

  const rules = createMemo(() => {
    try {
      const config = sync.data.config as any
      const autoGlobs = [Truncate.truncateGlob()]
      const collected = EffectiveNavigation.collectNavigationRules(config, autoGlobs)
      return EffectiveNavigation.deduplicateRules(collected)
    } catch {
      return []
    }
  })

  const allowed = createMemo(() => rules().filter((r) => r.action === "allow"))
  const denied = createMemo(() => rules().filter((r) => r.action === "deny"))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Directory Navigation
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={allowed().length > 0}
        fallback={<text fg={theme.textMuted}>No allowed directories</text>}
      >
        <text fg={theme.success}>Allowed Directories</text>
        <For each={allowed()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.text} wrapMode="word">
                {"✅ "}{String(rule.displayPath)}
              </text>
              <text fg={theme.textMuted}>
                ({sourceLabel(rule.source)})
              </text>
            </box>
          )}
        </For>
      </Show>

      <Show when={denied().length > 0}>
        <text fg={theme.error}>Denied Directories</text>
        <For each={denied()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.text} wrapMode="word">
                {"🚫 "}{String(rule.displayPath)}
              </text>
              <text fg={theme.textMuted}>
                ({sourceLabel(rule.source)})
              </text>
            </box>
          )}
        </For>
      </Show>

      <box gap={1}>
        <text fg={theme.textMuted}>
          Use <text fg={theme.info}>opencode dirs allow/deny &lt;path&gt;</text> to configure.
        </text>
      </box>

      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          Close
        </text>
      </box>
    </box>
  )
}
