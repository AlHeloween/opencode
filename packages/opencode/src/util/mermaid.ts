import { renderSvg, renderSvgWithConfig } from "mermaid-wasm-renderer"
import { execFileSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { which } from "./which"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "mermaid.renderer" })

export interface MermaidRenderOptions {
  theme?: "default" | "dark" | "forest" | "neutral" | "modern"
  width?: number
  height?: number
}

/**
 * Render Mermaid source to SVG using WASM
 */
export function renderMermaidToSvg(source: string, options?: MermaidRenderOptions): string | null {
  try {
    if (options?.theme) {
      return renderSvgWithConfig(source, undefined, options.theme)
    }
    return renderSvg(source)
  } catch (error) {
    log.debug("WASM mermaid render failed", { error: String(error) })
    return null
  }
}

/**
 * Render SVG to ASCII/text using chafa
 */
export function renderSvgToText(svg: string): string | null {
  const chafaPath = which("chafa")
  if (!chafaPath) return null

  const tmpFile = join(tmpdir(), `opencode_mermaid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.svg`)

  try {
    writeFileSync(tmpFile, svg)
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.6)
    const output = execFileSync(
      chafaPath,
      ["--format", "symbols", "--color-space", "rgb", "--size", `${cols}x${rows}`, tmpFile],
      { encoding: "utf-8", timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
    )
    return output
  } catch (error) {
    log.debug("chafa render failed for mermaid", { error: String(error) })
    return null
  } finally {
    try {
      unlinkSync(tmpFile)
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Render Mermaid source to ASCII/text (WASM + chafa pipeline)
 */
export function renderMermaidToText(source: string, options?: MermaidRenderOptions): string | null {
  const svg = renderMermaidToSvg(source, options)
  if (!svg) return null
  return renderSvgToText(svg)
}
