/**
 * MediaImage — renders images inline within the TUI chat layout.
 *
 * Primary path: decode → RGBA → OpenTUI <image> (PixelBuffer → Kitty or Sixel).
 * Fallback: half-block symbols when the terminal has no graphics protocol.
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

type RgbaFrame = {
  data: Uint8Array
  width: number
  height: number
}

function hasNativeGraphics(renderer: { capabilities: { kitty_graphics?: boolean; sixel?: boolean } | null }): boolean {
  const caps = renderer.capabilities
  return Boolean(caps?.kitty_graphics || caps?.sixel)
}

async function decodeDataUrlToRgba(dataUrl: string, maxCols: number): Promise<RgbaFrame | null> {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) return null

  const [, , base64] = match
  const bytes = Buffer.from(base64!, "base64")
  const j = (await import("jimp")) as any
  const img = await j.Jimp.read(bytes)

  const aspect = img.width / Math.max(1, img.height)
  const cols = Math.min(img.width, maxCols)
  const rows = Math.max(1, Math.round(cols / aspect))
  // Round height up to a sixel band so Sixel layout (ceil(h/6)) is stable.
  const sixelRows = Math.ceil(rows / 6) * 6
  img.resize({ w: cols, h: sixelRows })

  const data = new Uint8Array(cols * sixelRows * 4)
  for (let y = 0; y < sixelRows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4
      // Jimp bitmap is RGBA
      data[i] = img.bitmap.data[i]!
      data[i + 1] = img.bitmap.data[i + 1]!
      data[i + 2] = img.bitmap.data[i + 2]!
      data[i + 3] = img.bitmap.data[i + 3] ?? 255
    }
  }

  return { data, width: cols, height: sixelRows }
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

  onMount(async () => {
    if (!props.url) {
      setState("error")
      return
    }

    // Prefer OpenTUI PixelBuffer path when the terminal advertised Kitty or Sixel.
    if (hasNativeGraphics(renderer)) {
      try {
        const rgba = await decodeDataUrlToRgba(props.url, MAX_COLS)
        if (rgba) {
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
      if (tmp) {
        setStyledText(tmp.styled)
        setContentText(tmp.content)
        setState("symbols")
        return
      }
    } catch (e) {
      log.debug("MediaImage: symbols render failed", { error: String(e) })
    }

    setState("error")
  })

  createEffect(() => {
    const f = frame()
    if (!f || !imageRef || state() !== "native") return
    imageRef.setImage(f.data, f.width, f.height)
  })

  onCleanup(() => {
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
