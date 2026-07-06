import { renderSvg, renderSvgWithConfig } from "mermaid-wasm-renderer"
import { Resvg } from "@resvg/resvg-js"
import Chafa from "chafa-wasm"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "mermaid.renderer" })

let chafaInstance: Awaited<ReturnType<typeof Chafa>> | null = null

async function getChafa() {
  if (!chafaInstance) chafaInstance = await Chafa()
  return chafaInstance
}

export interface MermaidRenderOptions {
  theme?: "default" | "dark" | "forest" | "neutral" | "modern"
}

/** Render Mermaid source to SVG using WASM */
export function renderMermaidToSvg(source: string, options?: MermaidRenderOptions): string | null {
  try {
    if (options?.theme) return renderSvgWithConfig(source, undefined, options.theme)
    return renderSvg(source)
  } catch (error) {
    log.warn("WASM mermaid render failed", { error: String(error) })
    return null
  }
}

/** Render SVG to ANSI text using resvg + chafa-wasm */
export async function renderSvgToText(svg: string): Promise<string | null> {
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: (process.stdout.columns ?? 80) * 8 },
    })
    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()

    const chafa = await getChafa()
    const imageToAnsi = chafa.imageToAnsi as (
      buffer: ArrayBuffer,
      options: Record<string, unknown>,
    ) => Promise<{ ansi: string }>

    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.6)

    const { ansi } = await imageToAnsi(pngBuffer.buffer as ArrayBuffer, {
      format: chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_SYMBOLS.value,
      height: rows,
      width: cols,
      colors: chafa.ChafaCanvasMode.CHAFA_CANVAS_MODE_TRUECOLOR.value,
      colorSpace: chafa.ChafaColorSpace.CHAFA_COLOR_SPACE_RGB.value,
      symbols: "block+border+space-wide-inverted",
      preprocess: true,
      threshold: 0.5,
    })

    return ansi
  } catch (error) {
    log.warn("chafa-wasm render failed", { error: String(error) })
    return null
  }
}

/** Render Mermaid source to ANSI text: mermaid-rs → SVG → resvg → PNG → chafa → ANSI */
export async function renderMermaidToText(
  source: string,
  options?: MermaidRenderOptions,
): Promise<string | null> {
  const svg = renderMermaidToSvg(source, options)
  if (!svg) return null
  return renderSvgToText(svg)
}
