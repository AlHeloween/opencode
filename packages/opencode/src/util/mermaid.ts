/**
 * Mermaid diagram rendering — SVG via WASM, then PNG for 3D display.
 *
 * Pipeline: Mermaid source → mermaid-wasm-renderer (SVG) → resvg-js (PNG)
 * The PNG data URL is passed to <image-plane> in the TUI.
 *
 * WASM is loaded lazily on first render — no synchronous 2.8MB read at import time.
 * Timeout guards against pathological diagrams that hang the Rust engine.
 *
 * No chafa — OpenTUI's WebGPU pipeline handles the rendering.
 */
import { Resvg } from "@resvg/resvg-js"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "mermaid.renderer" })

const MERMAID_RENDER_TIMEOUT = 10_000 // 10s max per diagram

export interface MermaidRenderOptions {
  theme?: "default" | "dark" | "forest" | "neutral" | "modern"
}

// ── Lazy WASM loader ───────────────────────────────────────────────────────
// mermaid-wasm-renderer (CommonJS) reads a 2.8MB .wasm file synchronously at
// module load via require('fs').readFileSync. We defer that to first render,
// and also handle errors (missing binary, __dirname in ESM, etc.) gracefully.
let _renderer: typeof import("mermaid-wasm-renderer") | null = null
let _rendererLoading: Promise<typeof import("mermaid-wasm-renderer")> | null = null

async function getRenderer(): Promise<typeof import("mermaid-wasm-renderer")> {
  if (_renderer) return _renderer
  if (_rendererLoading) return _rendererLoading
  _rendererLoading = (async () => {
    try {
      const mod = await import("mermaid-wasm-renderer")
      _renderer = mod
      return mod
    } finally {
      _rendererLoading = null
    }
  })()
  return _rendererLoading
}

/** Register a system font for better text metrics in rendered diagrams. */
export async function registerMermaidFont(fontPath: string): Promise<boolean> {
  try {
    const mod = await getRenderer()
    const buf = await Bun.file(fontPath).arrayBuffer()
    mod.registerFont(new Uint8Array(buf))
    log.debug(`mermaid font registered: ${fontPath}`)
    return true
  } catch (error) {
    log.debug("mermaid font registration failed", { fontPath, error: String(error) })
    return false
  }
}

/** Reset the lazy loader state — for testing or recovery after failure. */
export function resetRendererCache(): void {
  _renderer = null
  _rendererLoading = null
}

// ── Timeout wrapper ─────────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  source: string,
  ms: number = MERMAID_RENDER_TIMEOUT,
): Promise<T> {
  const onTimeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Mermaid render timed out after ${ms}ms (${source.slice(0, 80).replace(/\n/g, " ")})`))
    }, ms)
    promise.finally(() => clearTimeout(id))
  })
  return Promise.race([promise, onTimeout])
}

// ── Rendering functions ─────────────────────────────────────────────────────

/** Render Mermaid source to SVG using WASM (lazy loaded, with timeout) */
export async function renderMermaidToSvg(
  source: string,
  options?: MermaidRenderOptions,
): Promise<string | null> {
  try {
    const mod = await withTimeout(getRenderer(), source)
    if (options?.theme) return mod.renderSvgWithConfig(source, undefined, options.theme)
    return mod.renderSvg(source)
  } catch (error) {
    log.warn("bug: mermaid WASM render failed", {
      source: source.slice(0, 100),
      error: String(error),
    })
    return null
  }
}

/** Render SVG to PNG data URL — ready for <image-plane> */
export function renderSvgToPngDataUrl(svg: string): string | null {
  try {
    const terminalWidth = process.stdout.columns ?? 80
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: terminalWidth * 8 },
    })
    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()
    const base64 = Buffer.from(pngBuffer).toString("base64")
    return `data:image/png;base64,${base64}`
  } catch (error) {
    log.warn("bug: mermaid PNG render failed", {
      error: String(error),
    })
    return null
  }
}

/** Render Mermaid source to PNG data URL (lazy WASM, timed, with fallback) */
export async function renderMermaidToPngDataUrl(
  source: string,
  options?: MermaidRenderOptions,
): Promise<string | null> {
  const svg = await renderMermaidToSvg(source, options)
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
