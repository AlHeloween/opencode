/**
 * MediaMermaid — renders mermaid diagrams inline.
 *
 * Pipeline priority:
 *   1. Mermaid WASM → SVG → PNG → Sixel (direct terminal write, no WebGPU)
 *   2. Mermaid WASM → SVG → PNG → <image-plane> (Three.js + WebGPU) — fallback
 *
 * The Sixel path bypasses WebGPU/Vulkan entirely. Used when the terminal
 * supports it (Windows Terminal 2024+, foot, Konsole, xterm-sixel).
 */
import { createSignal, onMount, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderMermaidToPngDataUrl } from "@/util/mermaid"
import { renderDataUrlToTerminal } from "@/util/render-image-to-terminal"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.mermaid" })

export function MediaMermaid(props: { source: string }) {
  const { theme, mode } = useTheme()

  // States: "loading" → "render" → "sixel" | "webgpu" | "error"
  const [state, setState] = createSignal<"loading" | "sixel" | "webgpu" | "error">("loading")
  const [dataUrl, setDataUrl] = createSignal<string | null>(null)
  const [terminalRows, setTerminalRows] = createSignal(0)

  onMount(() => {
    ;(async () => {
      try {
        // Step 1: Render mermaid to PNG data URL (WASM → SVG → PNG)
        const pngDataUrl = await renderMermaidToPngDataUrl(props.source, {
          theme: mode() === "dark" ? "dark" : "default",
        })

        if (!pngDataUrl) {
          setState("error")
          setDataUrl(null)
          return
        }

        // Step 2: Try Sixel terminal rendering first
        const result = await renderDataUrlToTerminal(pngDataUrl)
        if (result && result.protocol === "sixel") {
          log.debug("MediaMermaid: rendered via Sixel", { terminalRows: result.dimensions.terminalRows })
          setTerminalRows(result.dimensions.terminalRows)
          setState("sixel")
          return
        }

        // Step 3: Fall back to WebGPU/Three.js
        setDataUrl(pngDataUrl)
        setState("webgpu")
      } catch (err) {
        log.warn("bug: mermaid render failed in MediaMermaid", { error: String(err) })
        setState("error")
      }
    })()
  })

  return (
    <Switch>
      <Match when={state() === "sixel"}>
        {/* Sixel image already written to terminal — reserve blank rows */}
        <box paddingTop={1} paddingLeft={2} height={terminalRows()}>
          <text></text>
        </box>
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
