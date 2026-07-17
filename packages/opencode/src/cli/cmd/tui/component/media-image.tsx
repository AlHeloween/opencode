/**
 * MediaImage — renders images inline within the TUI chat layout.
 *
 * Primary path: decode → RGBA → OpenTUI <image> (PixelBuffer → Kitty or Sixel).
 * Fallback: half-block symbols when the terminal has no graphics protocol.
 *
 * Pixel sizing must match OpenTUI ImageRenderable layout math:
 *   layout cells = ceil(imagePx / cellPx)
 *
 * Both Kitty and modern Sixel (Windows Terminal, etc.) map image pixels to
 * *screen* pixels. Bitmaps must be sized as `maxCols * cellWidth` — not
 * ~80px “one pixel per cell”. The old 80×N sixel model rendered as a tiny
 * stamp (looked like “one pixel = one symbol”).
 */
import { createSignal, Switch, Match, onMount, createEffect, onCleanup } from "solid-js"
import { StyledText, SyntaxStyle, type ImageRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "./spinner"
import { imageToChunks } from "@/util/image-to-ansi"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

const MAX_COLS = 80
/** Match OpenTUI Image.ts defaults when terminal pixel resolution is unknown. */
const DEFAULT_CELL_WIDTH = 18
const DEFAULT_CELL_HEIGHT = 35
/** Capability detection can arrive after first paint — wait before locking path. */
const CAPS_WAIT_MS = 1000
const CAPS_POLL_MS = 50

export type GraphicsLayoutMode = "kitty" | "sixel" | "none"

type RgbaFrame = {
  data: Uint8Array
  width: number
  height: number
}

type CapsRenderer = {
  capabilities: { kitty_graphics?: boolean; sixel?: boolean } | null
  resolution?: { width: number; height: number } | null
  width?: number
  height?: number
}

export function graphicsLayoutMode(renderer: CapsRenderer): GraphicsLayoutMode {
  const caps = renderer.capabilities
  if (!caps) return "none"
  if (caps.kitty_graphics) return "kitty"
  if (caps.sixel) return "sixel"
  return "none"
}

export function cellPixelSize(renderer: CapsRenderer): { cellWidth: number; cellHeight: number } {
  const res = renderer.resolution
  const cols = renderer.width
  const rows = renderer.height
  if (res && res.width > 0 && res.height > 0 && cols && cols > 0 && rows && rows > 0) {
    return {
      cellWidth: res.width / cols,
      cellHeight: res.height / rows,
    }
  }
  return { cellWidth: DEFAULT_CELL_WIDTH, cellHeight: DEFAULT_CELL_HEIGHT }
}

/**
 * Target RGBA size for native graphics protocols.
 * Pure helper — unit-tested; keeps MediaImage and OpenTUI Image layout aligned.
 *
 * Kitty and Sixel both use screen-pixel bitmaps sized to fill `maxCols` cells.
 * Sixel height is rounded up to a multiple of 6 (encoder band size only).
 */
export function nativeImagePixelSize(input: {
  srcWidth: number
  srcHeight: number
  maxCols: number
  mode: GraphicsLayoutMode
  cellWidth: number
  cellHeight: number
}): { width: number; height: number } {
  const aspect = input.srcWidth / Math.max(1, input.srcHeight)
  const maxCols = Math.max(1, input.maxCols)
  const cellW = Math.max(1, input.cellWidth)
  // Fill maxCols cells at real cell pixel width (not 1px/cell).
  const width = Math.round(maxCols * cellW)
  let height = Math.max(1, Math.round(width / aspect))
  if (input.mode === "sixel") {
    height = Math.ceil(height / 6) * 6
  }
  return { width, height }
}

async function waitForCapabilities(renderer: CapsRenderer, timeoutMs: number): Promise<void> {
  if (renderer.capabilities) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (renderer.capabilities) return
    await new Promise((r) => setTimeout(r, CAPS_POLL_MS))
  }
}

async function decodeDataUrlToRgba(
  dataUrl: string,
  maxCols: number,
  mode: GraphicsLayoutMode,
  cellWidth: number,
  cellHeight: number,
): Promise<RgbaFrame | null> {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) return null

  const [, , base64] = match
  const bytes = Buffer.from(base64!, "base64")
  const j = (await import("jimp")) as any
  const img = await j.Jimp.read(bytes)

  const { width: cols, height: rows } = nativeImagePixelSize({
    srcWidth: img.width,
    srcHeight: img.height,
    maxCols,
    mode,
    cellWidth,
    cellHeight,
  })

  img.resize({ w: cols, h: rows })

  const data = new Uint8Array(cols * rows * 4)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4
      data[i] = img.bitmap.data[i]!
      data[i + 1] = img.bitmap.data[i + 1]!
      data[i + 2] = img.bitmap.data[i + 2]!
      data[i + 3] = img.bitmap.data[i + 3] ?? 255
    }
  }

  return { data, width: cols, height: rows }
}

export function MediaImage(props: { url: string; mime: string }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [state, setState] = createSignal<"loading" | "native" | "symbols" | "error">("loading")
  const [frame, setFrame] = createSignal<RgbaFrame | null>(null)
  const [styledText, setStyledText] = createSignal<StyledText | null>(null)
  const [contentText, setContentText] = createSignal("")
  const dummySyntax = SyntaxStyle.create()
  let imageRef: ImageRenderable | undefined
  let cancelled = false

  onMount(async () => {
    if (!props.url) {
      setState("error")
      return
    }

    // Capability probe often finishes after first mount; wait briefly so mermaid
    // does not permanently lock into half-block symbols on a graphics terminal.
    await waitForCapabilities(renderer as CapsRenderer, CAPS_WAIT_MS)
    if (cancelled) return

    const mode = graphicsLayoutMode(renderer as CapsRenderer)
    const cells = cellPixelSize(renderer as CapsRenderer)

    if (mode === "kitty" || mode === "sixel") {
      try {
        const rgba = await decodeDataUrlToRgba(props.url, MAX_COLS, mode, cells.cellWidth, cells.cellHeight)
        if (cancelled) return
        if (rgba) {
          log.debug("MediaImage: native path", {
            mode,
            width: rgba.width,
            height: rgba.height,
            cellWidth: cells.cellWidth,
            cellHeight: cells.cellHeight,
          })
          setFrame(rgba)
          setState("native")
          return
        }
      } catch (e) {
        log.debug("MediaImage: native decode failed, falling back to symbols", { error: String(e) })
      }
    }

    try {
      const tmp = await decodeAndSymbols(props.url)
      if (cancelled) return
      if (tmp) {
        log.debug("MediaImage: symbols path", { mode })
        setStyledText(tmp.styled)
        setContentText(tmp.content)
        setState("symbols")
        return
      }
    } catch (e) {
      log.debug("MediaImage: symbols render failed", { error: String(e) })
    }

    if (!cancelled) setState("error")
  })

  createEffect(() => {
    const f = frame()
    if (!f || !imageRef || state() !== "native") return
    imageRef.setImage(f.data, f.width, f.height)
  })

  onCleanup(() => {
    cancelled = true
    imageRef = undefined
  })

  return (
    <Switch>
      <Match when={state() === "native" && frame()}>
        {(f) => (
          <box paddingTop={1} paddingLeft={2}>
            <image
              ref={(r: ImageRenderable) => {
                imageRef = r
              }}
              data={f().data}
              imageWidth={f().width}
              imageHeight={f().height}
            />
          </box>
        )}
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

async function decodeAndSymbols(dataUrl: string): Promise<{ styled: StyledText; content: string } | null> {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) return null
  const [, ext, base64] = match
  const { writeFileSync, unlinkSync, existsSync } = await import("fs")
  const { join } = await import("path")
  const { tmpdir } = await import("os")
  const extName = ext === "jpeg" ? ".jpg" : ".png"
  const tmpFile = join(tmpdir(), `opencode_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${extName}`)
  try {
    writeFileSync(tmpFile, Buffer.from(base64!, "base64"))
    const chunks = await imageToChunks(tmpFile, { width: MAX_COLS })
    const all: Array<{ __isChunk: true; text: string; fg: any; bg: any }> = []
    const lines: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const row = chunks[i]!
      for (const c of row) {
        all.push({ __isChunk: true, text: c.text, fg: c.fg, bg: c.bg })
      }
      if (i < chunks.length - 1) {
        all.push({ __isChunk: true, text: "\n", fg: undefined, bg: undefined })
      }
      lines.push("▀".repeat(row.length))
    }
    return { styled: new StyledText(all), content: lines.join("\n") }
  } finally {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile)
    } catch {
      // best-effort temp cleanup
    }
  }
}
