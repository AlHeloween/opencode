/**
 * MediaImage — renders images inline within the TUI chat layout.
 *
 * Primary path: decode → RGBA → OpenTUI <image> (PixelBuffer → Kitty or Sixel).
 * Fallback: half-block symbols when the terminal has no graphics protocol.
 *
 * Sizing: read the image's natural width/height, then contain-fit into the
 * terminal box (maxCols × maxRows in cell pixels). Never force a fixed width.
 *
 * When `interactive` is true (mermaid diagrams):
 *   - Keep a high-res source buffer
 *   - Fixed display viewport
 *   - Mouse wheel = zoom, drag = pan, middle-click = reset
 */
import { createSignal, Switch, Match, onMount, createEffect, onCleanup, Show } from "solid-js"
import { StyledText, SyntaxStyle, type ImageRenderable, type MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "./spinner"
import { imageToChunks } from "@/util/image-to-ansi"
import { fitContainSize } from "@/util/fit-image"
import {
  type ViewportState,
  clampZoom,
  sampleViewport,
  zoomByWheel,
  panByCells,
} from "@/util/image-viewport"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.media.image" })

const MAX_COLS = 80
/** Cap image height in cells so tall diagrams don't dominate the session. */
const MAX_ROWS = 40
/** Match OpenTUI Image.ts defaults when terminal pixel resolution is unknown. */
const DEFAULT_CELL_WIDTH = 18
const DEFAULT_CELL_HEIGHT = 35
/** Capability detection can arrive after first paint — wait before locking path. */
const CAPS_WAIT_MS = 1000
const CAPS_POLL_MS = 50
/** Cap source decode for interactive zoom (memory). */
const INTERACTIVE_SRC_MAX = 2048

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
 */
export function nativeImagePixelSize(input: {
  srcWidth: number
  srcHeight: number
  maxCols: number
  maxRows?: number
  mode: GraphicsLayoutMode
  cellWidth: number
  cellHeight: number
}): { width: number; height: number } {
  const maxCols = Math.max(1, input.maxCols)
  const maxRows = Math.max(1, input.maxRows ?? MAX_ROWS)
  const cellW = Math.max(1, input.cellWidth)
  const cellH = Math.max(1, input.cellHeight)
  const fitted = fitContainSize({
    srcWidth: input.srcWidth,
    srcHeight: input.srcHeight,
    maxWidth: maxCols * cellW,
    maxHeight: maxRows * cellH,
    allowUpscale: false,
  })
  let { width, height } = fitted
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

function copyBitmap(img: { width: number; height: number; bitmap: { data: Uint8Array | Buffer } }): RgbaFrame {
  const cols = img.width
  const rows = img.height
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

async function decodeDataUrlToRgba(
  dataUrl: string,
  maxCols: number,
  maxRows: number,
  mode: GraphicsLayoutMode,
  cellWidth: number,
  cellHeight: number,
  opts?: { keepSourceMax?: number },
): Promise<{ display: RgbaFrame; source: RgbaFrame } | null> {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) return null

  const [, , base64] = match
  const bytes = Buffer.from(base64!, "base64")
  const j = (await import("jimp")) as any
  const img = await j.Jimp.read(bytes)

  // Optional: cap huge sources for interactive zoom memory
  const keepMax = opts?.keepSourceMax
  if (keepMax && (img.width > keepMax || img.height > keepMax)) {
    const scale = keepMax / Math.max(img.width, img.height)
    img.resize({
      w: Math.max(1, Math.round(img.width * scale)),
      h: Math.max(1, Math.round(img.height * scale)),
    })
  }

  const source = copyBitmap(img)

  const displaySize = nativeImagePixelSize({
    srcWidth: source.width,
    srcHeight: source.height,
    maxCols,
    maxRows,
    mode,
    cellWidth,
    cellHeight,
  })

  if (displaySize.width === source.width && displaySize.height === source.height) {
    return { display: source, source }
  }

  img.resize({ w: displaySize.width, h: displaySize.height })
  const display = copyBitmap(img)
  return { display, source }
}

export function MediaImage(props: {
  url: string
  mime: string
  /** Enable mouse-wheel zoom and drag-to-pan (mermaid diagrams). */
  interactive?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [state, setState] = createSignal<"loading" | "native" | "symbols" | "error">("loading")
  const [frame, setFrame] = createSignal<RgbaFrame | null>(null)
  const [styledText, setStyledText] = createSignal<StyledText | null>(null)
  const [contentText, setContentText] = createSignal("")
  const [viewport, setViewport] = createSignal<ViewportState>({ zoom: 1, panX: 0, panY: 0 })
  const [hint, setHint] = createSignal("")
  const dummySyntax = SyntaxStyle.create()
  let imageRef: ImageRenderable | undefined
  let cancelled = false
  /** Full-res source for interactive zoom (native path only). */
  let sourceFrame: RgbaFrame | null = null
  /** Original fit-quality frame (no nearest-neighbor viewport resample). */
  let fitFrame: RgbaFrame | null = null
  let displaySize: { width: number; height: number } | null = null
  let mode: GraphicsLayoutMode = "none"
  let lastDragX = 0
  let lastDragY = 0
  let dragging = false

  const pushFrame = (next: RgbaFrame) => {
    setFrame(next)
    if (imageRef) imageRef.setImage(next.data, next.width, next.height)
  }

  const rebuildView = (vp: ViewportState) => {
    if (!sourceFrame || !displaySize) return
    const z = clampZoom(vp.zoom)
    // At fit zoom with no pan, restore the original high-quality decode — never
    // nearest-neighbor resample (that is what made mermaid look like a blurry PNG stamp).
    if (z <= 1.001 && Math.abs(vp.panX) < 0.5 && Math.abs(vp.panY) < 0.5 && fitFrame) {
      pushFrame(fitFrame)
      setHint("wheel zoom · drag pan · middle-click reset")
      return
    }
    const data = sampleViewport(
      sourceFrame.data,
      sourceFrame.width,
      sourceFrame.height,
      displaySize.width,
      displaySize.height,
      vp,
    )
    pushFrame({ data, width: displaySize.width, height: displaySize.height })
    setHint(`zoom ${z.toFixed(1)}× · drag pan · middle-click reset`)
  }

  onMount(async () => {
    if (!props.url) {
      setState("error")
      return
    }

    await waitForCapabilities(renderer as CapsRenderer, CAPS_WAIT_MS)
    if (cancelled) return

    mode = graphicsLayoutMode(renderer as CapsRenderer)
    const cells = cellPixelSize(renderer as CapsRenderer)

    if (mode === "kitty" || mode === "sixel") {
      try {
        const termRows = (renderer as CapsRenderer).height
        const maxRows = Math.max(8, Math.min(MAX_ROWS, termRows ? Math.max(8, termRows - 6) : MAX_ROWS))
        const maxCols = Math.min(MAX_COLS, (renderer as CapsRenderer).width ?? MAX_COLS)
        const decoded = await decodeDataUrlToRgba(
          props.url,
          maxCols,
          maxRows,
          mode,
          cells.cellWidth,
          cells.cellHeight,
          props.interactive ? { keepSourceMax: INTERACTIVE_SRC_MAX } : undefined,
        )
        if (cancelled) return
        if (decoded) {
          sourceFrame = decoded.source
          fitFrame = decoded.display
          displaySize = { width: decoded.display.width, height: decoded.display.height }
          // Always show the decoded frame at zoom=1 — never nearest-neighbor
          // resample through sampleViewport (that turns sharp SVG→PNG into a
          // blurry pixelated stamp). Resample only after user zooms/pans.
          setFrame(decoded.display)
          if (props.interactive) {
            setHint("wheel zoom · drag pan · middle-click reset")
          }
          log.debug("MediaImage: native path", {
            mode,
            interactive: Boolean(props.interactive),
            displayW: displaySize.width,
            displayH: displaySize.height,
            sourceW: sourceFrame.width,
            sourceH: sourceFrame.height,
          })
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
    sourceFrame = null
    fitFrame = null
    displaySize = null
  })

  const handleMouse = (event: MouseEvent) => {
    if (!props.interactive || !sourceFrame || !displaySize || state() !== "native") return

    if (event.type === "scroll" && event.scroll) {
      const next = zoomByWheel(
        sourceFrame.width,
        sourceFrame.height,
        displaySize.width,
        displaySize.height,
        viewport(),
        event.scroll.direction,
      )
      setViewport(next)
      rebuildView(next)
      event.stopPropagation()
      event.preventDefault()
      return
    }

    // Middle-click resets zoom/pan
    if (event.type === "down" && event.button === 1) {
      const reset = { zoom: 1, panX: 0, panY: 0 }
      setViewport(reset)
      rebuildView(reset)
      event.stopPropagation()
      event.preventDefault()
      return
    }

    if (event.type === "down" && event.button === 0) {
      dragging = true
      lastDragX = event.x
      lastDragY = event.y
      event.stopPropagation()
      event.preventDefault()
      return
    }

    if (event.type === "drag" && dragging) {
      const dx = event.x - lastDragX
      const dy = event.y - lastDragY
      lastDragX = event.x
      lastDragY = event.y
      if (dx === 0 && dy === 0) return

      // Layout size in cells from ImageRenderable / pixel layout
      const cells = cellPixelSize(renderer as CapsRenderer)
      const layoutCols = Math.max(1, Math.ceil(displaySize.width / cells.cellWidth))
      const layoutRows = Math.max(1, Math.ceil(displaySize.height / cells.cellHeight))
      const next = panByCells(
        sourceFrame.width,
        sourceFrame.height,
        displaySize.width,
        displaySize.height,
        viewport(),
        dx,
        dy,
        layoutCols,
        layoutRows,
      )
      setViewport(next)
      rebuildView(next)
      event.stopPropagation()
      event.preventDefault()
      return
    }

    if (event.type === "drag-end" || event.type === "up") {
      if (dragging) {
        dragging = false
        event.stopPropagation()
      }
    }
  }

  return (
    <Switch>
      <Match when={state() === "native" && frame()}>
        {(f) => (
          <box
            paddingTop={1}
            paddingLeft={2}
            flexDirection="column"
            onMouseScroll={props.interactive ? handleMouse : undefined}
            onMouseDown={props.interactive ? handleMouse : undefined}
            onMouseDrag={props.interactive ? handleMouse : undefined}
            onMouseDragEnd={props.interactive ? handleMouse : undefined}
            onMouseUp={props.interactive ? handleMouse : undefined}
          >
            <image
              ref={(r: ImageRenderable) => {
                imageRef = r
              }}
              data={f().data}
              imageWidth={f().width}
              imageHeight={f().height}
            />
            <Show when={props.interactive && hint()}>
              <text fg={theme.textMuted}>{hint()}</text>
            </Show>
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
