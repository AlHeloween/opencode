/**
 * MediaImage — renders images inline within the TUI chat layout.
 *
 * Pipeline:
 *   1. Sixel (explicit) → direct terminal write at box position
 *   2. Symbols (auto-detect) → half-block ▀ fallback
 */
import { createSignal, Switch, Match, onMount, createEffect } from "solid-js"
import { StyledText, SyntaxStyle } from "@opentui/core"
import type { BoxRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "./spinner"
import { renderDataUrlToTerminal } from "@/util/render-image-to-terminal"
import { writeToTerminal } from "@/util/terminal-write"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const [state, setState] = createSignal<"loading" | "sixel" | "symbols" | "error">("loading")
  const [terminalRows, setTerminalRows] = createSignal(0)
  const [sixelSequence, setSixelSequence] = createSignal("")
  const [styledText, setStyledText] = createSignal<StyledText | null>(null)
  const [contentText, setContentText] = createSignal("")
  const dummySyntax = SyntaxStyle.create()
  let boxRef: BoxRenderable | undefined

  onMount(async () => {
    // Try Sixel first — many terminals support it but don't advertise via env vars.
    if (props.url) {
      try {
        const result = await renderDataUrlToTerminal(props.url, { protocol: "sixel", maxCols: 80, writeToTerminal: false })
        if (result && (result.protocol === "sixel" || result.protocol === "kitty")) {
          setTerminalRows(result.dimensions.terminalRows)
          setSixelSequence(result.escapeSequence)
          setState("sixel")
          return
        }
      } catch (e) {
        log.debug("MediaImage: Sixel failed, falling back to symbols", { error: String(e) })
      }
    }

    // Fallback: auto-detect (Sixel/Kitty/Symbols)
    try {
      const result = await renderDataUrlToTerminal(props.url, { writeToTerminal: false })
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
      if (result?.escapeSequence && result.protocol === "kitty") {
        setTerminalRows(result.dimensions.terminalRows)
        setSixelSequence(result.escapeSequence)
        setState("sixel")
        return
      }
    } catch (e) {
      log.debug("MediaImage: symbols render failed", { error: String(e) })
    }

    setState("error")
  })

  // Write Sixel at the box's absolute screen position after render.
  // Uses ref to read screenY/screenX from the placeholder BoxRenderable
  // and positions Sixel via \x1b[{y};{x}H (absolute cursor positioning, 1-based).
  createEffect(() => {
    const seq = sixelSequence()
    if (!seq || state() !== "sixel" || !boxRef) return
    const rows = terminalRows()
    if (rows <= 0) return
    queueMicrotask(() => {
      const y = boxRef.screenY + 1 // screenY is 0-based, terminal is 1-based; +1 for paddingTop
      const x = boxRef.screenX + 2 // screenX is 0-based; +2 for paddingLeft
      writeToTerminal(`\x1b[${y};${x}H${seq}`)
    })
  })

  return (
    <Switch>
      <Match when={state() === "sixel"}>
        <box ref={boxRef} paddingTop={1} paddingLeft={2} height={terminalRows()}>
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
