import { createSignal, createResource, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { execFileSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "@/util/which"
import { renderImageToTerminal } from "@/util/chafa-wasm-render"
import { detectBestProtocol } from "@/util/terminal-graphics"
import { useTuiConfig } from "@tui/context/tui-config"
import { Spinner } from "./spinner"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

// ---------------------------------------------------------------------------
// Binary chafa fallback — used when WASM rendering fails.
// Every path is logged; no silent fallthrough.
// ---------------------------------------------------------------------------

function removeTempFile(file: string) {
  try {
    unlinkSync(file)
  } catch (error) {
    log.debug("failed to remove temp image", { error: String(error) })
  }
}

function renderChafaBinary(url: string): string | null {
  log.debug("attempting binary chafa fallback")

  const base64 = url.split(",")[1]
  if (!base64 || base64.length === 0) {
    log.warn("bug: renderChafaBinary: no base64 data in url")
    return null
  }

  const chafaPath = which("chafa")
  if (!chafaPath) {
    log.debug("binary chafa not found in PATH — no fallback available")
    return null
  }

  const ext = url.startsWith("data:image/png") ? ".png"
    : url.startsWith("data:image/jpeg") ? ".jpg"
    : url.startsWith("data:image/webp") ? ".webp"
    : url.startsWith("data:image/gif") ? ".gif"
    : ".png"

  const tmpFile = join(tmpdir(), `opencode_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)

  try {
    writeFileSync(tmpFile, Buffer.from(base64, "base64"))
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.45)
    log.debug("renderChafaBinary: calling chafa", { chafaPath, cols, rows, tmpFile })
    const output = execFileSync(
      chafaPath,
      ["--format", "symbols", "--color-space", "rgb", "--size", `${cols}x${rows}`, tmpFile],
      { encoding: "utf-8", timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
    )
    log.debug("renderChafaBinary: success", { outputLength: output.length })
    return output
  } catch (error) {
    log.warn("bug: renderChafaBinary: chafa execution failed", { error: String(error) })
    return null
  } finally {
    removeTempFile(tmpFile)
  }
}

// ---------------------------------------------------------------------------
// Data URL → ArrayBuffer conversion
// ---------------------------------------------------------------------------

function dataUrlToBuffer(url: string): ArrayBuffer | null {
  const base64 = url.split(",")[1]
  if (!base64 || base64.length === 0) {
    log.warn("bug: dataUrlToBuffer: no base64 data in url")
    return null
  }

  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  } catch (error) {
    log.warn("bug: dataUrlToBuffer: base64 decode failed", { error: String(error) })
    return null
  }
}

// ---------------------------------------------------------------------------
// Async image rendering with protocol fallback chain
// ---------------------------------------------------------------------------

async function renderImageAsync(url: string, protocolOverride?: string): Promise<string> {
  const protocol = detectBestProtocol(protocolOverride)
  const imageBuffer = dataUrlToBuffer(url)

  if (!imageBuffer) {
    log.warn("bug: renderImageAsync: could not decode image data")
    return "[Image: could not decode data]"
  }

  const cols = process.stdout.columns ?? 80
  const rows = Math.floor((process.stdout.rows ?? 24) * 0.45)

  // ── Step 1: Try WASM with best detected protocol ────────────────────
  try {
    log.debug("renderImageAsync: trying WASM render", { protocol })
    const result = await renderImageToTerminal(imageBuffer, {
      protocol,
      width: cols,
      height: rows,
    })
    if (result) {
      return result
    }
    log.debug("renderImageAsync: WASM returned null for protocol", { protocol })
  } catch (error) {
    log.debug("renderImageAsync: WASM render failed for protocol", {
      protocol,
      error: String(error),
    })
  }

  // ── Step 2: Fall back to symbols via WASM ───────────────────────────
  if (protocol !== "symbols") {
    try {
      log.debug("renderImageAsync: falling back to WASM symbols")
      const result = await renderImageToTerminal(imageBuffer, {
        protocol: "symbols",
        width: cols,
        height: rows,
      })
      if (result) {
        return result
      }
      log.debug("renderImageAsync: WASM symbols returned null")
    } catch (error) {
      log.debug("renderImageAsync: WASM symbols failed", {
        error: String(error),
      })
    }
  }

  // ── Step 3: Fall back to binary chafa ───────────────────────────────
  log.debug("renderImageAsync: falling back to binary chafa")
  const binaryResult = renderChafaBinary(url)
  if (binaryResult) {
    return binaryResult
  }

  // ── Step 4: Nothing worked ──────────────────────────────────────────
  if (!which("chafa")) {
    log.warn("bug: renderImageAsync: all renderers failed — chafa not installed")
    return "chafa not installed - install chafa for terminal image rendering"
  }
  log.warn("bug: renderImageAsync: all renderers failed")
  return "Could not render image"
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
    () => props.url,
    async (url: string) => {
      if (!url) {
        log.debug("MediaImage: no url, skipping render")
        return null
      }
      log.debug("MediaImage: starting render", {
        mime: props.mime,
        urlPrefix: url.substring(0, 64),
        imageProtocol: imageProtocol ?? "auto",
      })
      try {
        const result = await renderImageAsync(url, imageProtocol)
        log.debug("MediaImage: render complete", { resultLength: result.length })
        return result
      } catch (err) {
        const msg = `render failed: ${String(err)}`
        log.warn("bug: MediaImage: render threw", { error: String(err) })
        setError(msg)
        return null
      }
    },
  )

  return (
    <Switch>
      <Match when={error()}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.textMuted}>{error()!}</text>
        </box>
      </Match>
      <Match when={output() !== null && output() !== undefined}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.text}>{output()!}</text>
        </box>
      </Match>
      <Match when={output.loading}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <Spinner color={theme.textMuted} />
          <text fg={theme.textMuted}>Rendering image...</text>
        </box>
      </Match>
      <Match when={true}>
        <box paddingTop={1} paddingLeft={2} gap={1}>
          <text fg={theme.textMuted}>Rendering image...</text>
        </box>
      </Match>
    </Switch>
  )
}
