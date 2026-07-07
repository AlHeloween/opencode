/**
 * Mermaid diagram rendering — SVG via WASM, then PNG for 3D display.
 *
 * Pipeline: Mermaid source → mermaid-wasm-renderer (SVG) → resvg-js (PNG)
 * The PNG data URL is passed to <image-plane> in the TUI.
 *
 * No chafa — OpenTUI's WebGPU pipeline handles the rendering.
 */
import { renderSvg, renderSvgWithConfig } from "mermaid-wasm-renderer"
import { Resvg } from "@resvg/resvg-js"
import * as Log from "@opencode-ai/core/util/log"

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

/** Render SVG to PNG data URL — ready for <image-plane> */
export function renderSvgToPngDataUrl(svg: string): string | null {
  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: (process.stdout.columns ?? 80) * 8 },
    })
    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()
    const base64 = Buffer.from(pngBuffer).toString("base64")
    return `data:image/png;base64,${base64}`
  } catch (error) {
    log.debug("resvg PNG render failed", { error: String(error) })
    return null
  }
}

/** Render Mermaid source to PNG data URL */
export function renderMermaidToPngDataUrl(
  source: string,
  options?: MermaidRenderOptions,
): string | null {
  const svg = renderMermaidToSvg(source, options)
  if (!svg) return null
  return renderSvgToPngDataUrl(svg)
}

// ── Backward compat: old name → new pipeline ─────────────────────
/** @deprecated Use renderMermaidToPngDataUrl + <image-plane> */
export async function renderSvgToText(_svg: string): Promise<string | null> {
  return null
}

/** @deprecated Use renderMermaidToPngDataUrl + <image-plane> */
export async function renderMermaidToText(
  _source: string,
  _options?: MermaidRenderOptions,
): Promise<string | null> {
  return null
}
