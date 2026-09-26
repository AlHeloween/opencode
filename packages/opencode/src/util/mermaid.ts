/**
 * Mermaid diagram rendering — SVG via WASM, then RGBA for native TUI display.
 *
 * Pipeline: Mermaid source → mermaid-wasm-renderer (SVG) → resvg-js (RGBA).
 * PNG is produced only when MediaImage needs its symbol-renderer fallback.
 *
 * WASM is loaded lazily on first render — no synchronous 2.8MB read at import time.
 * Timeout guards against pathological diagrams that hang the Rust engine.
 *
 * Native terminal graphics are emitted by OpenTUI's synchronized Zig renderer.
 */
import { Resvg } from "@resvg/resvg-js"
import { RGBA } from "@opentui/core"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import fs from "fs"
import path from "path"
import { fitFontAnchoredSize, fitToWidthSize, parseSvgFontSize, parseSvgNaturalSize } from "./fit-image"
import { readEmbeddedWasmAsset } from "./wasm-embedded"
import { getMermaidWasmRenderer, resetMermaidWasmRenderer, type MermaidWasmRenderer } from "./mermaid-wasm"
import type { AnsiChunk } from "./image-to-ansi"

const log = Log.create({ service: "mermaid.renderer" })

const MERMAID_RENDER_TIMEOUT = 10_000 // 10s max per diagram
/**
 * Cell pixel budget for high-quality terminal display.
 * Match OpenTUI Image defaults (~18×35) so SVG is rasterized at screen density,
 * not a ~12×20 low-res stamp that looks like a pixelated screenshot.
 */
const FALLBACK_CELL_W = 18

export type SvgFitBudget = {
  /**
   * Target SVG/raster **width** in CSS px. Height is never set here — resvg
   * `fitTo: width` derives height from the diagram's natural aspect.
   */
  maxWidth?: number
  /**
   * Accepted for compatibility — NOT a sizing input. Width clamps; height flows at the
   * anchored scale and the raster is inserted as-is (owner ruling, 2026-09-26:
   * «клампить ширину, высоту отпускать и вставлять как есть»). Kept optional so
   * MediaImage can still pass a terminal box without effect.
   */
  maxHeight?: number
  /**
   * Physical terminal cell height in device px (CSI 16t). When present, the
   * raster scale is anchored to the FONT and `maxWidth` becomes a clamp instead
   * of a target — see {@link fitFontAnchoredSize}. Without it the old
   * width-filling behaviour is kept, because there is nothing to anchor to.
   */
  cellHeight?: number
  /** How many terminal rows one line of diagram text should occupy. Default 1. */
  labelCells?: number
}

/** Terminal width budget (px) for mermaid SVG — height is not a budget input. */
export function mermaidPixelBudget(opts?: SvgFitBudget): { maxWidth: number } {
  const cols = process.stdout.columns ?? 80
  return {
    maxWidth: opts?.maxWidth ?? Math.max(64, cols * FALLBACK_CELL_W),
  }
}

/**
 * Build resvg options: **width only**, height automatic from SVG aspect.
 *
 * Large diagrams always match the given width; tall diagrams stay tall (scroll)
 * instead of being re-shrunk by a maxHeight contain box.
 */
type MermaidResvgFont = { loadSystemFonts: boolean; fontFiles: string[]; defaultFontFamily: string }
type MermaidResvgOptions = { background: string; font?: MermaidResvgFont; fitTo?: { mode: "width" | "height"; value: number } }

/** Embedded font options — the font travels WITH the binary (BunFS → materialized path). */
function resvgFont(): { font?: MermaidResvgFont } {
  if (!mermaidFontFilePath) return {}
  return { font: { loadSystemFonts: false, fontFiles: [mermaidFontFilePath], defaultFontFamily: mermaidFontFamily } }
}

export function resvgOptionsForSvg(svg: string, background: string, budget?: SvgFitBudget): MermaidResvgOptions {
  const maxWidth = mermaidPixelBudget(budget).maxWidth
  // Attribute/viewBox parse. A probe `new Resvg(svg, {background})` used to sit here to read
  // width/height — it re-ran the system-font scan (~230 ms) and the SAME SVG tree was then
  // parsed again for the real render, i.e. the scan was paid twice per diagram (2026-09-24).
  const parsed = parseSvgNaturalSize(svg)
  const srcW = parsed?.width ?? 0
  const srcH = parsed?.height ?? 0
  if (srcW <= 0 || srcH <= 0) {
    // Unparseable SVG — still force width so large unknown trees fit horizontally.
    return { background, ...resvgFont(), fitTo: { mode: "width", value: maxWidth } }
  }

  // Preferred path: anchor the scale to the terminal cell so label text is the
  // same size in every diagram and follows the user's font. Width only clamps.
  if (budget?.cellHeight && budget.cellHeight > 0) {
    const { width, scale, clamped } = fitFontAnchoredSize({
      srcWidth: srcW,
      srcHeight: srcH,
      srcFontPx: parseSvgFontSize(svg) ?? 0,
      cellHeight: budget.cellHeight,
      labelCells: budget.labelCells,
      maxWidth,
    })
    log.debug("mermaid raster scale anchored to cell", {
      srcW,
      srcH,
      cellHeight: budget.cellHeight,
      scale: Number(scale.toFixed(3)),
      clamped,
      outW: width,
    })
    // HEIGHT FLOWS; only width clamps (owner ruling, 2026-09-26: «клампить ширину, высоту
    // отпускать и вставлять как есть»). The 2026-09-23 height re-fit lived here and divided the
    // font-anchored scale on tall diagrams — text that was exactly ONE terminal row tall arrived
    // smaller than a row, which is the «нечитаемо» it had meant to fix. The anchor is the floor:
    // the only smaller scale comes from the width clamp inside fitFontAnchoredSize, and only when
    // the diagram genuinely does not fit horizontally. A raster taller than the row budget is
    // inserted as-is — the MediaImage is interactive (wheel zoom · drag pan).
    return { background, ...resvgFont(), fitTo: { mode: "width", value: width } }
  }

  // No measured cell (PNG symbol fallback): nothing to anchor to, so keep the
  // old width-filling behaviour rather than inventing a cell size.
  const { width } = fitToWidthSize({
    srcWidth: srcW,
    srcHeight: srcH,
    width: maxWidth,
    allowUpscale: true,
  })
  return { background, ...resvgFont(), fitTo: { mode: "width", value: width } }
}

export interface MermaidRenderOptions {
  theme?: "default" | "dark" | "forest" | "neutral" | "modern"
}

export type MermaidRgbaFrame = {
  data: Uint8Array
  width: number
  height: number
}

// ── Lazy WASM loader ───────────────────────────────────────────────────────
// mermaid-wasm-renderer (CommonJS) reads a 2.8MB .wasm file synchronously at
// module load via require('fs').readFileSync. We defer that to first render,
// and also handle errors (missing binary, __dirname in ESM, etc.) gracefully.
let _renderer: MermaidWasmRenderer | null = null
let _rendererLoading: Promise<MermaidWasmRenderer> | null = null

async function getRenderer(): Promise<MermaidWasmRenderer> {
  if (_renderer) return _renderer
  if (_rendererLoading) return _rendererLoading
  _rendererLoading = (async () => {
    try {
      const mod = await getMermaidWasmRenderer()
      if (!mod) throw new Error("mermaid WASM renderer unavailable")
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
  rgbaFrames.clear()
  resetMermaidWasmRenderer()
}

// The diagram must look like the app's own text, so the terminal face wins: Consolas is the
// "вбитый" system font on this host (owner directive 2026-09-24: «мы вбили consolas пусть и
// будет»). The embedded OFL font stays as the deterministic fallback for machines without it.
const MERMAID_TERMINAL_FONTS: Array<{ file: string; family: string }> = [
  { file: "C:/Windows/Fonts/consola.ttf", family: "Consolas" },
]
const MERMAID_FONT_ASSET = "fonts/CascadiaMono.ttf"
const MERMAID_EMBEDDED_FAMILY = "Cascadia Mono"
let mermaidFontFamily = MERMAID_EMBEDDED_FAMILY
// The theme must ASK for the active face. WASM measures label text by the registered font and
// resvg rasterizes by fontFiles; while the SVG asked for "Inter,…" the layout measured the
// engine's calibrated fallback while the raster drew another face — labels were sized wrong
// (owner: «размер шрифтов не учитывается», 2026-09-24). With the family in the theme, both
// engines resolve the SAME face.
const mermaidFontConfig = () =>
  JSON.stringify({
    themeVariables: { fontFamily: `${mermaidFontFamily}, ui-sans-serif, system-ui, sans-serif` },
  })

// Embedded font: materialized once to a real file (resvg accepts only paths, not
// buffers) and registered with the WASM engine, so layout metrics and the raster
// share ONE font. Like a font embedded in a PDF — the binary carries it, the system
// is never consulted, and the render is identical on every machine.
let mermaidFontFilePath: string | null = null
let mermaidFontSetup: Promise<void> | null = null

async function ensureMermaidFont(mod: MermaidWasmRenderer): Promise<void> {
  if (mermaidFontFilePath) return
  if (mermaidFontSetup) return mermaidFontSetup
  mermaidFontSetup = (async () => {
    try {
      // 1) Terminal face first — the diagram must match the app's own text (owner, 2026-09-24).
      for (const candidate of MERMAID_TERMINAL_FONTS) {
        const stat = await fs.promises.stat(candidate.file).catch(() => null)
        if (!stat || !stat.isFile()) continue
        const bytes = await fs.promises.readFile(candidate.file)
        mod.registerFont(new Uint8Array(bytes))
        mermaidFontFilePath = candidate.file
        mermaidFontFamily = candidate.family
        log.info("mermaid font ready (terminal face)", {
          file: candidate.file,
          family: candidate.family,
          bytes: bytes.byteLength,
        })
        return
      }
      // 2) Embedded OFL fallback (PDF-style: the binary carries it).
      const asset = await readEmbeddedWasmAsset(MERMAID_FONT_ASSET)
      if (!asset.bytes) {
        log.warn("bug: mermaid font asset missing", { tried: asset.tried })
        return
      }
      const dir = path.join(Global.Path.cache, "fonts")
      await fs.promises.mkdir(dir, { recursive: true })
      const file = path.join(dir, "CascadiaMono.ttf")
      const known = await fs.promises.stat(file).catch(() => null)
      if (!known || known.size !== asset.bytes.byteLength) {
        await fs.promises.writeFile(file, Buffer.from(asset.bytes))
      }
      mod.registerFont(new Uint8Array(asset.bytes))
      mermaidFontFilePath = file
      mermaidFontFamily = MERMAID_EMBEDDED_FAMILY
      log.info("mermaid font ready (embedded)", { file, bytes: asset.bytes.byteLength })
    } catch (error) {
      log.warn("bug: mermaid font setup failed", { error: String(error) })
    } finally {
      mermaidFontSetup = null
    }
  })()
  return mermaidFontSetup
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
  const started = performance.now()
  try {
    const mod = await withTimeout(getRenderer(), source)
    await ensureMermaidFont(mod)
    const svg = mod.renderSvgWithConfig(source, mermaidFontConfig(), options?.theme ?? "modern")
    log.info("mermaid SVG rendered", {
      sourceChars: source.length,
      svgChars: svg.length,
      elapsedMs: Math.round(performance.now() - started),
    })
    return svg
  } catch (error) {
    log.warn("bug: mermaid WASM render failed", {
      source: source.slice(0, 100),
      error: String(error),
      elapsedMs: Math.round(performance.now() - started),
    })
    return null
  }
}

/** Rasterize SVG directly into the RGBA frame consumed by OpenTUI ImageRenderable. */
export function renderSvgToRgba(
  svg: string,
  background?: string,
  budget?: SvgFitBudget,
): MermaidRgbaFrame | null {
  const started = performance.now()
  try {
    const rendered = new Resvg(svg, resvgOptionsForSvg(svg, background ?? "#ffffff", budget)).render()
    const frame = {
      data: rendered.pixels,
      width: rendered.width,
      height: rendered.height,
    }
    log.info("mermaid SVG rasterized to RGBA", {
      outW: frame.width,
      outH: frame.height,
      outputBytes: frame.data.byteLength,
      elapsedMs: Math.round(performance.now() - started),
    })
    return frame
  } catch (error) {
    log.warn("bug: mermaid RGBA render failed", {
      error: String(error),
      elapsedMs: Math.round(performance.now() - started),
    })
    return null
  }
}

/** Render SVG to PNG data URL for MediaImage's symbols fallback. */
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
    log.info("mermaid PNG rasterized", {
      outW: pngData.width,
      outH: pngData.height,
      outputBytes: pngBuffer.length,
    })
    return `data:image/png;base64,${base64}`
  } catch (error) {
    log.warn("bug: mermaid PNG render failed", {
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
    // Quad is 4px/cell (2×2); width-only fit, height automatic.
    const resvg = new Resvg(
      svg,
      resvgOptionsForSvg(svg, "#fafafc", {
        maxWidth: maxCols * 4,
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
 * Finished RGBA frames by their inputs. A diagram is a pure function of (source, theme, background,
 * budget), so a remount — re-entering a session, loading an older page, expanding a group — must look
 * the frame up instead of re-running WASM → SVG → RGBA (T10). Insertion order is the LRU order; a hit is
 * re-inserted. Eight entries bound the worst case (an 80×40-cell box is a few MB of RGBA each). A failed
 * render is not stored, so a later attempt can still succeed. Frames are shared read-only.
 */
const RGBA_FRAME_CACHE_MAX = 8
const rgbaFrames = new Map<string, Promise<MermaidRgbaFrame | null>>()

/** Mermaid source → SVG → direct RGBA. Native TUI graphics do not need a PNG hop. */
export function renderMermaidToRgba(
  source: string,
  options?: MermaidRenderOptions & { background?: string; budget?: SvgFitBudget },
): Promise<MermaidRgbaFrame | null> {
  const key = JSON.stringify([source, options?.theme, options?.background, options?.budget])
  const stored = rgbaFrames.get(key)
  if (stored) {
    rgbaFrames.delete(key)
    rgbaFrames.set(key, stored)
    return stored
  }
  const pending = renderMermaidToSvg(source, options).then((svg) => {
    if (svg) return renderSvgToRgba(svg, options?.background, options?.budget)
    return null
  })
  rgbaFrames.set(key, pending)
  pending.then(
    (frame) => {
      if (!frame && rgbaFrames.get(key) === pending) rgbaFrames.delete(key)
    },
    (error) => {
      log.warn("bug: mermaid RGBA render rejected", { error: String(error) })
      if (rgbaFrames.get(key) === pending) rgbaFrames.delete(key)
    },
  )
  while (rgbaFrames.size > RGBA_FRAME_CACHE_MAX) rgbaFrames.delete(rgbaFrames.keys().next().value!)
  return pending
}

// ── Backward compat: old name → new pipeline ─────────────────────
/** @deprecated Native TUI rendering uses renderSvgToRgba through MediaImage. */
export async function renderSvgToText(_svg: string): Promise<string | null> {
  return null
}

/** @deprecated Native TUI rendering uses renderMermaidToRgba through MediaImage. */
export async function renderMermaidToText(
  _source: string,
  _options?: MermaidRenderOptions,
): Promise<string | null> {
  return null
}
