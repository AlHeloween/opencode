import { createSignal, onMount, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderMermaidToText } from "@/util/mermaid"
import { which } from "@/util/which"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.mermaid" })

export function MediaMermaid(props: { source: string }) {
  const { theme, mode } = useTheme()
  const [output, setOutput] = createSignal<string | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const result = await renderMermaidToText(props.source, {
        theme: mode() === "dark" ? "dark" : "default",
      })
      if (result === null) {
        setError("Could not render diagram")
      }
      setOutput(result)
    } catch (err) {
      log.debug("failed to render mermaid diagram", { error: String(err) })
      setError("Diagram render error")
    }
    setLoaded(true)
  })

  return (
    <Switch>
      <Match when={error()}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.textMuted}>{error()!}</text>
          <text fg={theme.textMuted}>{props.source.slice(0, 200)}</text>
        </box>
      </Match>
      <Match when={loaded()}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.text}>{output() ?? ""}</text>
        </box>
      </Match>
      <Match when={true}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering diagram...</text>
        </box>
      </Match>
    </Switch>
  )
}
