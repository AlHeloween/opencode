import { createSignal, onMount, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderMermaidToPngDataUrl } from "@/util/mermaid"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.mermaid" })

export function MediaMermaid(props: { source: string }) {
  const { theme, mode } = useTheme()
  const [dataUrl, setDataUrl] = createSignal<string | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  onMount(() => {
    try {
      const pngDataUrl = renderMermaidToPngDataUrl(props.source, {
        theme: mode() === "dark" ? "dark" : "default",
      })
      if (!pngDataUrl) {
        setError("Could not render diagram")
      }
      setDataUrl(pngDataUrl)
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
        </box>
      </Match>
      <Match when={loaded() && dataUrl()}>
        <image-plane url={dataUrl()!} mime="image/png" width={70} />
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
