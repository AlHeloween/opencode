/**
 * media-image.tsx — render images via chafa-wasm with terminal protocol detection.
 *
 * When a graphics protocol (Kitty/Sixel/iTerm2) is available, writes escape codes
 * directly to stdout — bypassing the OpenTUI render tree for pixel-perfect output.
 * Falls back to Unicode symbols via <text> component on basic terminals.
 */
import { createSignal, createResource, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderImageToTerminal } from "@/util/chafa-wasm-render"
import { detectBestProtocol } from "@/util/terminal-graphics"
import { useTuiConfig } from "@tui/context/tui-config"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

// ---------------------------------------------------------------------------
// Data URL → ArrayBuffer
// ---------------------------------------------------------------------------

function dataUrlToBuffer(url: string): ArrayBuffer | null {
  const base64 = url.split(",")[1]
  if (!base64 || base64.length === 0) return null
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  } catch (err) {
    log.warn("bug: base64 decode failed", { error: String(err) })
    return null
  }
}

// ---------------------------------------------------------------------------
// Determine if we can use direct escape codes (graphics protocols)
// vs must use the TUI render tree (Unicode symbols)
// ---------------------------------------------------------------------------

function isGraphicsProtocol(protocol: string): boolean {
  return protocol === "kitty" || protocol === "sixel" || protocol === "iterm2"
}

// ---------------------------------------------------------------------------
// Render image — direct stdout for graphics protocols, <text> for symbols
// ---------------------------------------------------------------------------

async function renderImage(url: string, protocolOverride?: string): Promise<{
  text: string      // for display in <text> component (symbols mode)
  direct: string | null  // escape codes written directly to stdout
}> {
  const protocol = detectBestProtocol(protocolOverride)
  const imageBuffer = dataUrlToBuffer(url)
  if (!imageBuffer) return { text: "Could not decode image", direct: null }

  const cols = 80
  const rows = Math.floor(24 * 0.45)

  // ── Graphics protocol → write directly to stdout ──────────────
  if (isGraphicsProtocol(protocol)) {
    try {
      log.debug("rendering via graphics protocol", { protocol })
      const result = await renderImageToTerminal(imageBuffer, { protocol, width: cols, height: rows })
      if (result) {
        // Write escape codes directly to stdout — bypasses OpenTUI render tree
        // Save cursor, write image, restore cursor
        process.stdout.write("\x1b7")       // save cursor
        process.stdout.write(result)         // Kitty/Sixel/iTerm2 escape codes
        process.stdout.write("\x1b8")       // restore cursor
        log.debug("direct stdout render success", { protocol, outputLength: result.length })
        return { text: "", direct: result }
      }
      log.debug("graphics protocol returned null, falling back to symbols")
    } catch (err) {
      log.debug("graphics protocol render failed, falling back to symbols", { error: String(err) })
    }
  }

  // ── Symbols fallback → render via <text> component ────────────
  try {
    log.debug("rendering via symbols fallback")
    const result = await renderImageToTerminal(imageBuffer, { protocol: "symbols", width: cols, height: rows })
    if (result) return { text: result, direct: null }
    log.warn("bug: symbols render returned null")
  } catch (err) {
    log.warn("bug: symbols render failed", { error: String(err) })
  }
  return { text: "Could not render image", direct: null }
}

// ---------------------------------------------------------------------------
// SolidJS component
// ---------------------------------------------------------------------------

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const [error, setError] = createSignal<string | null>(null)

  const imageProtocol = tuiConfig?.image_protocol

  const [output] = createResource(
    () => ({ url: props.url, protocol: imageProtocol }),
    async ({ url, protocol }) => {
      if (!url) return null
      log.debug("MediaImage: rendering", { mime: props.mime, protocol: protocol ?? "auto" })
      try {
        const result = await renderImage(url, protocol)
        log.debug("MediaImage: done", { hasDirect: !!result.direct, textLen: result.text.length })
        return result
      } catch (err) {
        const msg = String(err)
        log.warn("bug: MediaImage render threw", { error: msg })
        setError(msg)
        return null
      }
    },
  )

  return (
    <Switch>
      <Match when={error()}>
        <box paddingTop={1} paddingLeft={2}>
          <text fg={theme.textMuted}>{error()!}</text>
        </box>
      </Match>
      <Match when={output() !== null && output() !== undefined && !output.loading}>
        <box paddingTop={1} paddingLeft={2}>
          <text fg={theme.text}>{output()!.text || " "}</text>
        </box>
      </Match>
      <Match when={output.loading}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering image...</text>
        </box>
      </Match>
      <Match when={true}>
        <box paddingTop={1} paddingLeft={2}>
          <text fg={theme.textMuted}>Rendering image...</text>
        </box>
      </Match>
    </Switch>
  )
}
