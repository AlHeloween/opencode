/**
 * MediaMermaid — renders mermaid diagrams inline.
 *
 * Pipeline:
 *   1. Mermaid WASM → SVG → PNG data URL → MediaImage (native Kitty/Sixel via OpenTUI)
 *   2. Fallback: <image-plane> (Three.js + WebGPU) if decode/native path fails hard
 */
import { createSignal, onMount, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderMermaidToPngDataUrl } from "@/util/mermaid"
import { MediaImage } from "./media-image"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.mermaid" })

export function MediaMermaid(props: { source: string }) {
  const { theme, mode } = useTheme()

  const [state, setState] = createSignal<"loading" | "image" | "webgpu" | "error">("loading")
  const [dataUrl, setDataUrl] = createSignal<string | null>(null)

  onMount(() => {
    ;(async () => {
      try {
        const bg = mode() === "dark" ? "#1a1b26" : "#ffffff"
        const pngDataUrl = await renderMermaidToPngDataUrl(props.source, {
          theme: mode() === "dark" ? "dark" : "default",
          background: bg,
        })

        if (!pngDataUrl) {
          setState("error")
          setDataUrl(null)
          return
        }

        log.debug("MediaMermaid: PNG ready for native Image pipeline")
        setDataUrl(pngDataUrl)
        setState("image")
      } catch (err) {
        log.warn("bug: mermaid render failed in MediaMermaid", { error: String(err) })
        setState("error")
      }
    })()
  })

  return (
    <Switch>
      <Match when={state() === "image" && dataUrl()}>
        {(url) => <MediaImage url={url()!} mime="image/png" interactive />}
      </Match>
      <Match when={state() === "webgpu" && dataUrl()}>
        <image-plane url={dataUrl()!} mime="image/png" width={70} />
      </Match>
      <Match when={state() === "error"}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.textMuted}>Diagram render error</text>
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
