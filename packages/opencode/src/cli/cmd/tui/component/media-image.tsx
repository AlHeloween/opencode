/**
 * MediaImage — renders images inline within the TUI chat layout.
 *
 * Pipeline:
 *   1. Sixel (explicit) → direct terminal write, bypasses protocol detection
 *   2. Symbols (auto-detect) → half-block ▀ fallback
 */
import { createSignal, Switch, Match, onMount } from "solid-js"
import { StyledText, SyntaxStyle } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "./spinner"
import { renderDataUrlToTerminal } from "@/util/render-image-to-terminal"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const [state, setState] = createSignal<"loading" | "sixel" | "symbols" | "error">("loading")
  const [terminalRows, setTerminalRows] = createSignal(0)
  const [styledText, setStyledText] = createSignal<StyledText | null>(null)
  const [contentText, setContentText] = createSignal("")
  const dummySyntax = SyntaxStyle.create()

  onMount(async () => {
    // Try Sixel first — many terminals support it but don't advertise via env vars.
    if (props.url) {
      try {
        const result = await renderDataUrlToTerminal(props.url, { protocol: "sixel", maxCols: 80 })
        if (result && (result.protocol === "sixel" || result.protocol === "kitty")) {
          setTerminalRows(result.dimensions.terminalRows)
          setState("sixel")
          return
        }
      } catch (e) {
        log.debug("MediaImage: Sixel failed, falling back to symbols", { error: String(e) })
      }
    }

    // Fallback: auto-detect (Sixel/Kitty/Symbols)
    try {
      const result = await renderDataUrlToTerminal(props.url)
      if (result?.chunks) {
        setTerminalRows(result.chunks.length)
        const all: Array<{ __isChunk: true; text: string; fg: any; bg: any }> = []
        const lines: string[] = []
        for (let i = 0; i < result.chunks.length; i++) {
          const row = result.chunks[i]!
          for (const c of row) {
            all.push({ __isChunk: true, text: c.text, fg: c.fg, bg: c.bg })
          }
          if (i < result.chunks.length - 1) {
            all.push({ __isChunk: true, text: "\n", fg: undefined, bg: undefined })
          }
          lines.push("▀".repeat(row.length))
        }
        setStyledText(new StyledText(all))
        setContentText(lines.join("\n"))
        setState("symbols")
        return
      }
    } catch (e) {
      log.debug("MediaImage: symbols render failed", { error: String(e) })
    }

    setState("error")
  })

  return (
    <Switch>
      <Match when={state() === "sixel"}>
        <box paddingTop={1} paddingLeft={2} height={terminalRows()}>
          <text></text>
        </box>
      </Match>
      <Match when={state() === "symbols" && styledText()}>
        <box paddingTop={1} paddingLeft={2}>
          <code
            content={contentText()}
            drawUnstyledText={true}
            filetype="ansi"
            syntaxStyle={dummySyntax}
            initialStyledText={styledText()!}
          />
        </box>
      </Match>
      <Match when={state() === "loading"}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering image...</text>
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
