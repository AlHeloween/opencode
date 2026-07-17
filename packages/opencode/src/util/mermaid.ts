/**
 * Mermaid diagram rendering — SVG via WASM, then PNG for 3D display.
 *
 * Pipeline: Mermaid source → mermaid-wasm-renderer (SVG) → resvg-js (PNG)
 * The PNG data URL is passed to <image-plane> in the TUI.
 *
 * WASM is loaded lazily on first render — no synchronous 2.8MB read at import time.
 * Timeout guards against pathological diagrams that hang the Rust engine.
 *
 * Image rendering handled by render-image-to-terminal (kitty/sixel/symbols).
 */
import { Resvg } from "@resvg/resvg-js"
import { RGBA } from "@opentui/core"
import * as Log from "@opencode-ai/core/util/log"
import { fitContainSize, parseSvgNaturalSize } from "./fit-image"
import { pixelsToSixel } from "./sixel-render"
import type { AnsiChunk } from "./image-to-ansi"

const log = Log.create({ service: "mermaid.renderer" })

const MERMAID_RENDER_TIMEOUT = 10_000 // 10s max per diagram
/**
 * Cell pixel budget for high-quality terminal display.
 * Match OpenTUI Image defaults (~18×35) so SVG is rasterized at screen density,
 * not a ~12×20 low-res stamp that looks like a pixelated screenshot.
 */
const FALLBACK_CELL_W = 18
const FALLBACK_CELL_H = 35
/** Cap mermaid height so a 100×10000 graph does not explode the chat. */
const DEFAULT_MAX_ROWS = 40
/**
 * Minimum scale-up for small mermaid SVGs (vector → PNG). Natural mermaid sizes
 * are often ~300px; without upscale, sixel/kitty maps few pixels per cell →
 * chunky aliased text ("Start" as pixel blocks).
 */
const MIN_VECTOR_UPSCALE = 2

export type SvgFitBudget = {
  maxWidth?: number
  maxHeight?: number
}

/** Terminal pixel budget for fitting mermaid's natural SVG size. */
export function mermaidPixelBudget(opts?: SvgFitBudget): { maxWidth: number; maxHeight: number } {
  const cols = process.stdout.columns ?? 80
  const rows = process.stdout.rows ?? 40
  return {
    maxWidth: opts?.maxWidth ?? Math.max(64, cols * FALLBACK_CELL_W),
    maxHeight: opts?.maxHeight ?? Math.max(64, Math.min(DEFAULT_MAX_ROWS, Math.max(8, rows - 6)) * FALLBACK_CELL_H),
  }
}

/**
 * Build resvg options from mermaid's natural SVG size.
 * Vector sources may upscale into the terminal box (crisp text); only shrink
 * when the diagram exceeds the budget (contain-fit). Never force a fixed width.
 */
export function resvgOptionsForSvg(
  svg: string,
  background: string,
  budget?: SvgFitBudget,
): { background: string; fitTo?: { mode: "zoom"; value: number } } {
  const box = mermaidPixelBudget(budget)
  // Prefer Resvg's parse of the SVG tree; fall back to attribute/viewBox parse.
  let srcW = 0
  let srcH = 0
  try {
    const probe = new Resvg(svg, { background })
    srcW = probe.width
    srcH = probe.height
  } catch {
    const parsed = parseSvgNaturalSize(svg)
    if (parsed) {
      srcW = parsed.width
      srcH = parsed.height
    }
  }
  if (srcW <= 0 || srcH <= 0) {
    // Unparseable SVG — render as-is (resvg may still succeed).
    return { background }
  }
  // Contain into terminal box; allow upscale so small mermaid SVGs stay sharp.
  let { scale } = fitContainSize({
    srcWidth: srcW,
    srcHeight: srcH,
    maxWidth: box.maxWidth,
    maxHeight: box.maxHeight,
    allowUpscale: true,
  })
  // Prefer at least 2× when budget allows (natural ~300px is too soft for sixel).
  if (scale < MIN_VECTOR_UPSCALE) {
    const room = Math.min(box.maxWidth / srcW, box.maxHeight / srcH)
    scale = Math.min(MIN_VECTOR_UPSCALE, room)
  }
  if (Math.abs(scale - 1) < 0.001) return { background }
  return { background, fitTo: { mode: "zoom", value: scale } }
}

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
export function renderSvgToPngDataUrl(
  svg: string,
  background?: string,
  budget?: SvgFitBudget,
): string | null {
  try {
    const bg = background ?? "#ffffff"
    const resvg = new Resvg(svg, resvgOptionsForSvg(svg, bg, budget))
    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()
    const base64 = Buffer.from(pngBuffer).toString("base64")
    log.debug("mermaid PNG sized from natural SVG", {
      outW: pngData.width,
      outH: pngData.height,
    })
    return `data:image/png;base64,${base64}`
  } catch (error) {
    log.warn("bug: mermaid PNG render failed", {
      error: String(error),
    })
    return null
  }
}

/**
 * Render SVG directly to Sixel escape sequence.
 * Bypasses PNG entirely: SVG → resvg (RGBA pixels) → 5-6-5 quantize → Sixel.
 * Same quality as the Python cube demo — zero PNG artifacts.
 */
export function renderSvgToSixel(svg: string, maxCols: number = 60, background?: string): string | null {
  try {
    const bg = background ?? "#ffffff"
    const resvg = new Resvg(
      svg,
      resvgOptionsForSvg(svg, bg, {
        maxWidth: maxCols * FALLBACK_CELL_W,
      }),
    )
    const rendered = resvg.render()
    const pixels: Uint8Array = rendered.pixels
    const width = rendered.width
    const height = rendered.height

    if (!pixels || width === 0 || height === 0) return null

    return pixelsToSixel(pixels, width, height)
  } catch (error) {
    log.warn("bug: mermaid SVG→Sixel render failed", {
      error: String(error),
    })
    return null
  }
}

// ── Quadrant Unicode rendering (4px/cell, inline, no terminal write) ──────

const QUAD_CHARS: Record<number, string> = {
  0b0000: " ", 0b0001: "▝", 0b0010: "▐", 0b0011: "▗",
  0b0100: "▘", 0b0101: "▞", 0b0110: "▌", 0b0111: "▙",
  0b1000: "▀", 0b1001: "▚", 0b1010: "▜", 0b1011: "▛",
  0b1100: "▄", 0b1101: "▟", 0b1110: "▖", 0b1111: "█",
}

/**
 * Render SVG to quadrant Unicode chunks for inline TUI rendering.
 * 4 pixels per terminal cell (2×2) using ▀▄▌▐█▖▗▘▙▚▛▜▝▞▟ characters.
 * Pure CPU, no terminal device write, fits within TUI layout.
 */
export function renderSvgToQuadChunks(svg: string, maxCols: number = 60): AnsiChunk[][] | null {
  try {
    // Quad is 4px/cell (2×2); budget in source pixels then render with contain-fit.
    const resvg = new Resvg(
      svg,
      resvgOptionsForSvg(svg, "#fafafc", {
        maxWidth: maxCols * 4,
        maxHeight: DEFAULT_MAX_ROWS * 8,
      }),
    )
    const rendered = resvg.render()
    const pixels: Uint8Array = rendered.pixels
    const pw = rendered.width
    const ph = rendered.height

    if (!pixels || pw < 2 || ph < 2) return null

    const rows = Math.floor(ph / 2)
    const cols = Math.floor(pw / 2)

    const result: AnsiChunk[][] = []
    for (let cy = 0; cy < rows; cy++) {
      const line: AnsiChunk[] = []
      for (let cx = 0; cx < cols; cx++) {
        // Read 2×2 pixel block: TL, TR, BL, BR
        const tlIdx = (cy * 2 * pw + cx * 2) * 4
        const trIdx = tlIdx + 4
        const blIdx = ((cy * 2 + 1) * pw + cx * 2) * 4
        const brIdx = blIdx + 4

        // Luminance for each of the 4 sub-pixels
        const lumTL = 0.299 * pixels[tlIdx]! + 0.587 * pixels[tlIdx + 1]! + 0.114 * pixels[tlIdx + 2]!
        const lumTR = 0.299 * pixels[trIdx]! + 0.587 * pixels[trIdx + 1]! + 0.114 * pixels[trIdx + 2]!
        const lumBL = 0.299 * pixels[blIdx]! + 0.587 * pixels[blIdx + 1]! + 0.114 * pixels[blIdx + 2]!
        const lumBR = 0.299 * pixels[brIdx]! + 0.587 * pixels[brIdx + 1]! + 0.114 * pixels[brIdx + 2]!

        // Split: above/below median → fg (dark) / bg (light)
        const lums = [lumTL, lumTR, lumBL, lumBR]
        const sorted = [...lums].sort((a, b) => a - b)
        const cutoff = (sorted[1]! + sorted[2]!) / 2
        // When all lums equal, use "<=" to avoid all-space (bits=0) on solid areas
        const allSame = sorted[0] === sorted[3]
        const isFg = (lum: number) => allSame ? lum <= cutoff : lum < cutoff

        // Quadrant bits: TL=8, TR=4, BL=2, BR=1  (1 = dark/fg, 0 = light/bg)
        const bits =
          ((isFg(lumTL) ? 8 : 0) |
           (isFg(lumTR) ? 4 : 0) |
           (isFg(lumBL) ? 2 : 0) |
           (isFg(lumBR) ? 1 : 0))

        // Average colors for dark (fg) and light (bg) pixel groups
        let fgR = 0, fgG = 0, fgB = 0, fgN = 0
        let bgR = 0, bgG = 0, bgB = 0, bgN = 0

        const addPx = (pxIdx: number, isFgPx: boolean) => {
          if (isFgPx) { fgR += pixels[pxIdx]!; fgG += pixels[pxIdx + 1]!; fgB += pixels[pxIdx + 2]!; fgN++ }
          else        { bgR += pixels[pxIdx]!; bgG += pixels[pxIdx + 1]!; bgB += pixels[pxIdx + 2]!; bgN++ }
        }
        addPx(tlIdx, !!(bits & 8))
        addPx(trIdx, !!(bits & 4))
        addPx(blIdx, !!(bits & 2))
        addPx(brIdx, !!(bits & 1))

        if (fgN === 0) { fgR = bgR; fgG = bgG; fgB = bgB; fgN = 1 }
        if (bgN === 0) { bgR = fgR; bgG = fgG; bgB = fgB; bgN = 1 }

        line.push({
          fg: RGBA.fromInts(Math.round(fgR / fgN), Math.round(fgG / fgN), Math.round(fgB / fgN)),
          bg: RGBA.fromInts(Math.round(bgR / bgN), Math.round(bgG / bgN), Math.round(bgB / bgN)),
          text: QUAD_CHARS[bits] ?? " ",
        })
      }
      result.push(line)
    }
    return result
  } catch (error) {
    log.warn("bug: mermaid SVG→Quad render failed", { error: String(error) })
    return null
  }
}

/**
 * Render Mermaid source to quadrant chunks for inline TUI rendering.
 * 4px/cell resolution, no terminal write, fits in TUI layout.
 */
export async function renderMermaidToQuadChunks(
  source: string,
  options?: MermaidRenderOptions & { maxCols?: number },
): Promise<AnsiChunk[][] | null> {
  const svg = await renderMermaidToSvg(source, options)
  if (!svg) return null
  return renderSvgToQuadChunks(svg, options?.maxCols ?? 60)
}

/** Render Mermaid source to PNG data URL (lazy WASM, timed, with fallback) */
export async function renderMermaidToPngDataUrl(
  source: string,
  options?: MermaidRenderOptions & { background?: string },
): Promise<string | null> {
  const svg = await renderMermaidToSvg(source, options)
  if (!svg) return null
  return renderSvgToPngDataUrl(svg, options?.background)
}

/**
 * Render Mermaid source directly to Sixel escape sequence.
 * Full pipeline: source → WASM → SVG → resvg pixels → Sixel.
 * Zero PNG — same quality as the Python cube demo.
 * Returns the escape sequence (ready for writeToTerminal) or null.
 */
export async function renderMermaidToSixelStream(
  source: string,
  options?: MermaidRenderOptions & { maxCols?: number },
): Promise<string | null> {
  const svg = await renderMermaidToSvg(source, options)
  if (!svg) return null
  return renderSvgToSixel(svg, options?.maxCols ?? 60)
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
