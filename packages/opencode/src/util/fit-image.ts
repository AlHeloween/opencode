/**
 * Image/SVG layout helpers.
 *
 * Mermaid SVGs are width-driven: give a target width, height follows from the
 * diagram's natural aspect (never a joint maxWidth×maxHeight contain box that
 * re-shrinks width when height is large).
 */

export type FitContainInput = {
  srcWidth: number
  srcHeight: number
  maxWidth: number
  maxHeight: number
  /**
   * When false (default), never enlarge past natural size — only shrink to fit.
   * Set true when scaling vector sources where upscale is free (e.g. SVG via resvg).
   */
  allowUpscale?: boolean
}

export type FitContainResult = {
  width: number
  height: number
  /** Multiplier applied to src (≤ 1 unless allowUpscale). */
  scale: number
}

/**
 * Scale (srcWidth × srcHeight) to fit inside (maxWidth × maxHeight).
 * Aspect ratio is preserved. Degenerate sizes clamp to 1×1.
 * Prefer {@link fitToWidthSize} for mermaid SVG (width only).
 */
export function fitContainSize(input: FitContainInput): FitContainResult {
  const sw = Math.max(1, Math.round(input.srcWidth))
  const sh = Math.max(1, Math.round(input.srcHeight))
  const maxW = Math.max(1, Math.round(input.maxWidth))
  const maxH = Math.max(1, Math.round(input.maxHeight))

  let scale = Math.min(maxW / sw, maxH / sh)
  if (!input.allowUpscale) scale = Math.min(1, scale)
  // Guard against zero/negative from bad inputs after min()
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))
  return { width, height, scale }
}

export type FitToWidthInput = {
  srcWidth: number
  srcHeight: number
  /** Target output width in CSS/px. Height is never an input. */
  width: number
  /**
   * When false, only shrink diagrams wider than `width`; smaller ones keep natural size.
   * When true (vector SVG), always emit exactly `width` and height = f(aspect).
   */
  allowUpscale?: boolean
}

/**
 * Width-only fit: set width, height is automatic from natural aspect.
 * Does not take a maxHeight — tall diagrams stay tall (scroll), large ones always
 * match the given width.
 */
export function fitToWidthSize(input: FitToWidthInput): FitContainResult {
  const sw = Math.max(1, Math.round(input.srcWidth))
  const sh = Math.max(1, Math.round(input.srcHeight))
  const targetW = Math.max(1, Math.round(input.width))

  let scale = targetW / sw
  if (!input.allowUpscale) scale = Math.min(1, scale)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))
  return { width, height, scale }
}

export type FitFontAnchoredInput = {
  srcWidth: number
  srcHeight: number
  /** Intrinsic text size inside the source SVG, CSS px. */
  srcFontPx: number
  /** Physical terminal cell height in device px (CSI 16t). */
  cellHeight: number
  /** How many terminal rows one line of diagram text should occupy. Default 1. */
  labelCells?: number
  /** Hard width clamp in device px — the diagram may not exceed it. */
  maxWidth: number
}

export type FitFontAnchoredResult = FitContainResult & {
  /** True when the width clamp, not the font anchor, decided the scale. */
  clamped: boolean
}

/**
 * Scale a diagram so its TEXT has a predictable size, then clamp to the width.
 *
 * Width-driven fitting makes apparent text size a function of the diagram's
 * natural width, which for mermaid tracks node count: measured 2026-09-18, the
 * same 14px label renders at 136px in a two-node graph and 6px in a twelve-node
 * chain on the same terminal — a 22x spread with nothing the user can predict.
 *
 * Anchoring on the cell instead makes the label a fixed number of terminal rows
 * tall, so it tracks the user's font size and stays constant across diagrams.
 * Width stops being the target and becomes a limit: a diagram still shrinks when
 * it genuinely does not fit, which is legible, unlike being silently enlarged.
 */
export function fitFontAnchoredSize(input: FitFontAnchoredInput): FitFontAnchoredResult {
  const sw = Math.max(1, Math.round(input.srcWidth))
  const sh = Math.max(1, Math.round(input.srcHeight))
  const maxW = Math.max(1, Math.round(input.maxWidth))
  const fontPx = Number.isFinite(input.srcFontPx) && input.srcFontPx > 0 ? input.srcFontPx : DEFAULT_SVG_FONT_PX
  const cellH = Math.max(1, input.cellHeight)
  const labelCells = Number.isFinite(input.labelCells) && (input.labelCells ?? 0) > 0 ? input.labelCells! : 1

  const fontScale = (cellH * labelCells) / fontPx
  const widthScale = maxW / sw
  const clamped = widthScale < fontScale
  const scale = clamped ? widthScale : fontScale

  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
    scale,
    clamped,
  }
}

/** Mermaid's intrinsic label size — measured 2026-09-18, constant across diagrams and themes. */
export const DEFAULT_SVG_FONT_PX = 14

/**
 * Intrinsic text size of an SVG in CSS px — the most frequent `font-size` in the
 * document, which for mermaid is the node-label size. Returns null when the SVG
 * declares none, so callers can apply their own default rather than guess here.
 */
export function parseSvgFontSize(svg: string): number | null {
  const counts = new Map<number, number>()
  for (const match of svg.matchAll(/font-size\s*[:=]\s*["']?\s*([0-9.]+)\s*(px)?/gi)) {
    const value = Number(match[1])
    if (!Number.isFinite(value) || value <= 0) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  // Ties resolve to the smaller size: it is the one that decides legibility.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]
}

/** Parse width/height from SVG root attributes or viewBox (CSS px). */
export function parseSvgNaturalSize(svg: string): { width: number; height: number } | null {
  // Prefer explicit width/height on the root <svg>
  const open = svg.match(/<svg\b[^>]*>/i)?.[0]
  if (!open) return null

  const num = (raw: string | undefined): number | null => {
    if (!raw) return null
    const m = raw.trim().match(/^([0-9.]+)/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const wAttr = open.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1]
  const hAttr = open.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1]
  const w = num(wAttr)
  const h = num(hAttr)
  if (w != null && h != null) return { width: w, height: h }

  const vb = open.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number)
    if (parts.length >= 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! }
    }
  }
  return null
}
