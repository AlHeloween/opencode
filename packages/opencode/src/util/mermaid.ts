import { renderSvg, renderSvgWithConfig } from "mermaid-wasm-renderer"
import { Resvg } from "@resvg/resvg-js"
import * as Log from "@opencode-ai/core/util/log"
import { getChafa, buildChafaConfig } from "@/util/chafa-wasm-render"

const log = Log.create({ service: "mermaid.renderer" })

export interface MermaidRenderOptions {
  theme?: "default" | "dark" | "forest" | "neutral" | "modern"
}

/** Render Mermaid source to SVG using WASM */
export function renderMermaidToSvg(source: string, options?: MermaidRenderOptions): string | null {
  try {
    if (options?.theme) return renderSvgWithConfig(source, undefined, options.theme)
    return renderSvg(source)
  } catch (error) {
    log.debug("WASM mermaid render failed", { error: String(error) })
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

    const cfg = buildChafaConfig(chafa, { width: cols, height: rows })

    const { ansi } = await imageToAnsi(pngBuffer.buffer as ArrayBuffer, cfg)

    return ansi
  } catch (error) {
    log.debug("chafa-wasm render failed", { error: String(error) })
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
