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
import { createSignal, onMount, createEffect, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderMermaidToPngDataUrl } from "@/util/mermaid"
import { renderDataUrlToTerminal } from "@/util/render-image-to-terminal"
import { writeToTerminal } from "@/util/terminal-write"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.mermaid" })

export function MediaMermaid(props: { source: string }) {
  const { theme, mode } = useTheme()

  // States: "loading" → "render" → "sixel" | "webgpu" | "error"
  const [state, setState] = createSignal<"loading" | "sixel" | "webgpu" | "error">("loading")
  const [dataUrl, setDataUrl] = createSignal<string | null>(null)
  const [terminalRows, setTerminalRows] = createSignal(0)
  const [sixelSequence, setSixelSequence] = createSignal("")

  onMount(() => {
    ;(async () => {
      try {
        // Step 1: Render mermaid to PNG data URL (WASM → SVG → PNG)
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

        // Step 2: Try Sixel terminal rendering — don't write yet,
        // defer to createEffect below so it lands at the box position.
        const result = await renderDataUrlToTerminal(pngDataUrl, { writeToTerminal: false })
        if (result && result.protocol === "sixel") {
          log.debug("MediaMermaid: rendered via Sixel", { terminalRows: result.dimensions.terminalRows })
          setTerminalRows(result.dimensions.terminalRows)
          setSixelSequence(result.escapeSequence)
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

  // Write Sixel escape sequence at the box position after render.
  // Same pattern as MediaImage: save cursor, back up to box start,
  // write Sixel (fills rows), restore cursor.
  createEffect(() => {
    const seq = sixelSequence()
    if (!seq || state() !== "sixel") return
    const rows = terminalRows()
    if (rows <= 0) return
    queueMicrotask(() => {
      writeToTerminal(`\x1b[s\x1b[${rows}A${seq}\x1b[u`)
    })
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
