import { createMemo, For, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"

export function DialogSubagentSettings(props: { targetAgent?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()

  const agentName = createMemo(() => props.targetAgent ?? local.agent.current()?.name ?? "")

  const current = createMemo(() => {
    const allowed = local.model.subagentsFor(agentName())
    return new Set(allowed ?? [])
  })

  const subagents = createMemo(() =>
    sync.data.agent.filter((a) => a.mode === "subagent" && !a.hidden),
  )

  const hasOverride = createMemo(() => {
    const effective = local.model.subagentsFor(agentName())
    const global = sync.data.agent.find((a) => a.name === agentName())?.subagents
    if (!effective && !global) return false
    if (!effective || !global) return true
    if (effective.length !== global.length) return true
    const es = new Set(effective)
    return !global.every((g) => es.has(g))
  })

  const toggle = (name: string) => {
    const cur = new Set(current())
    if (cur.has(name)) cur.delete(name)
    else cur.add(name)
    local.model.setSubagents(agentName(), cur.size > 0 ? [...cur] : undefined)
  }

  const clearOverride = () => {
    local.model.setSubagents(agentName(), undefined)
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
      evt.preventDefault()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}>
            <b>Subagent allow-list — {agentName()}</b>
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>
      <For each={subagents()}>
        {(agent) => {
          const active = createMemo(() => current().has(agent.name))
          return (
            <box
              paddingLeft={4}
              paddingRight={4}
              flexDirection="row"
              gap={2}
              onMouseUp={() => toggle(agent.name)}
              backgroundColor={
                active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)
              }
            >
              <text
                fg={active() ? theme.backgroundPanel : theme.textMuted}
              >
                {active() ? "✓" : "✗"}
              </text>
              <text fg={active() ? theme.backgroundPanel : theme.text}>
                {agent.name}
              </text>
              <text
                fg={active() ? theme.backgroundPanel : theme.textMuted}
              >
                {agent.description}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={hasOverride()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <box
            onMouseUp={clearOverride}
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <text fg={theme.text}>
              Clear session override — use global defaults
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}
