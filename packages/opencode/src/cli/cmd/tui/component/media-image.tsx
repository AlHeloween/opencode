/**
 * MediaImage — renders images inline.
 *
 * Pipeline priority:
 *   1. Sixel (terminal native image protocol) → direct terminal write → no WebGPU
 *   2. <image-plane> → @opentui/three (Three.js + WebGPU) — fallback
 *
 * Sixel bypasses WebGPU/Vulkan entirely: PNG → Jimp → Sixel escape → CON/tty.
 * Only used when the terminal supports it (Windows Terminal 2024+, foot, Konsole).
 */
import { createSignal, createEffect, Switch, Match, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "./spinner"
import { renderDataUrlToTerminal } from "@/util/render-image-to-terminal"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const [state, setState] = createSignal<"loading" | "sixel" | "webgpu" | "error">("loading")
  const [terminalRows, setTerminalRows] = createSignal(0)

  onMount(async () => {
    try {
      const result = await renderDataUrlToTerminal(props.url)
      if (result && result.protocol === "sixel") {
        log.debug("MediaImage: rendered via Sixel", { terminalRows: result.dimensions.terminalRows })
        setTerminalRows(result.dimensions.terminalRows)
        setState("sixel")
        return
      }
    } catch (e) {
      log.debug("MediaImage: Sixel failed, falling back to WebGPU", { error: String(e) })
    }

    // Fall back to WebGPU/Three.js
    if (props.url) {
      setState("webgpu")
    } else {
      setState("error")
    }
  })

  return (
    <Switch>
      <Match when={state() === "sixel"}>
        {/* Sixel image already written to terminal — reserve blank rows */}
        <box paddingTop={1} paddingLeft={2} height={terminalRows()}>
          <text></text>
        </box>
      </Match>
      <Match when={state() === "webgpu"}>
        <image-plane url={props.url} mime={props.mime} width={70} />
      </Match>
      <Match when={state() === "loading"}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering via WebGPU...</text>
        </box>
      </Match>
      <Match when={state() === "error"}>
        <box paddingTop={1} paddingLeft={2}>
          <text fg={theme.textMuted}>[image unavailable]</text>
        </box>
      </Match>
    </Switch>
  )
}
