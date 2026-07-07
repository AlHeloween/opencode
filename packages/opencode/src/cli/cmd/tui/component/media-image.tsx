/**
 * MediaImage — renders images using the best available method:
 *   1. <image-plane> — OpenTUI 3D renderable (GPU, no escape code issues)
 *   2. chafa-wasm symbols — Unicode block characters (always works)
 */
import { createSignal, createResource, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { renderImageToTerminal } from "@/util/chafa-wasm-render"
import { detectBestProtocol, detectGraphicsProtocol } from "@/util/terminal-graphics"
import { useTuiConfig } from "@tui/context/tui-config"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

function isGraphicsProtocol(p: string) {
  return p === "kitty" || p === "sixel" || p === "iterm2"
}

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

async function render(url: string, override?: string): Promise<{ text: string; use3D: boolean }> {
  const protocol = detectBestProtocol(override)

  // ── Graphics terminal: use <image-plane> 3D renderable ──────────
  if (isGraphicsProtocol(protocol)) {
    log.debug("using 3D image-plane renderable", { protocol })
    return { text: "", use3D: true }
  }

  // ── Symbols fallback ────────────────────────────────────────────
  const buf = dataUrlToBuffer(url)
  if (!buf) return { text: "Could not decode image", use3D: false }

  try {
    const cols = 80
    const rows = Math.floor(24 * 0.45)
    const result = await renderImageToTerminal(buf, { protocol: "symbols", width: cols, height: rows })
    return { text: result ?? "Could not render image", use3D: false }
  } catch (err) {
    log.warn("bug: symbols render failed", { error: String(err) })
    return { text: "Could not render image", use3D: false }
  }
}

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
        return await render(url, protocol)
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
      {/* 3D renderable for graphics-capable terminals */}
      <Match when={output()?.use3D}>
        <image-plane url={props.url} mime={props.mime} width={70} />
      </Match>
      {/* Unicode symbols for basic terminals */}
      <Match when={output() !== null && !output.loading && !output()?.use3D}>
        <box paddingTop={1} paddingLeft={2}>
          <text fg={theme.text}>{output()!.text}</text>
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
