// Image renderable — RGBA frames via native PixelBuffer → Kitty or Sixel graphics.

import { Renderable, type RenderableOptions } from "../Renderable.js"
import { PixelBuffer } from "../buffer.js"
import type { CliRenderer } from "../renderer.js"
import type { RenderContext } from "../types.js"

const DEFAULT_CELL_WIDTH = 18
const DEFAULT_CELL_HEIGHT = 35
const SIXEL_FALLBACK_CELL_WIDTH = 12
const SIXEL_FALLBACK_CELL_HEIGHT = 20

function getCellSize(renderer: CliRenderer, mode: "kitty" | "sixel" | "none"): { cellWidth: number | null; cellHeight: number | null } {
  if (mode === "sixel" && renderer.cellSize) {
    return {
      cellWidth: renderer.cellSize.width,
      cellHeight: renderer.cellSize.height,
    }
  }
  if (!renderer.resolution) {
    return { cellWidth: null, cellHeight: null }
  }
  const cellWidth = renderer.resolution.width / renderer.width
  const cellHeight = renderer.resolution.height / renderer.height
  return { cellWidth, cellHeight }
}

/** Prefer Kitty when advertised; otherwise Sixel for layout math (6 px ≈ 1 row). */
function graphicsLayoutMode(renderer: CliRenderer): "kitty" | "sixel" | "none" {
  const caps = renderer.capabilities
  if (!caps) return "none"
  if (caps.kitty_graphics) return "kitty"
  if (caps.sixel) return "sixel"
  return "none"
}

function getImageSize(
  imageWidth: number,
  imageHeight: number,
  cellWidth: number | null,
  cellHeight: number | null,
  mode: "kitty" | "sixel" | "none",
): { width: number; height: number } {
  // Kitty and modern Sixel (Windows Terminal, xterm, WezTerm) map image
  // pixels to screen pixels; layout cells = ceil(px / cellPx).
  //
  // The old Sixel model (1 sixel column = 1 cell, 6 rows = 1 cell) made
  // 80×N bitmaps look like a few-cell "stamp" on those terminals — each
  // source pixel effectively became one glyph-sized blob.
  //
  // Classic 1:1 is only kept as a last resort when mode is sixel AND we
  // have no cell metrics at all (defaults still prefer screen-pixel layout).
  const cw = cellWidth ?? (mode === "sixel" ? SIXEL_FALLBACK_CELL_WIDTH : DEFAULT_CELL_WIDTH)
  const ch = cellHeight ?? (mode === "sixel" ? SIXEL_FALLBACK_CELL_HEIGHT : DEFAULT_CELL_HEIGHT)
  const width = Math.ceil(imageWidth / Math.max(1, cw))
  const height = Math.ceil(imageHeight / Math.max(1, ch))
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

export interface ImageOptions extends RenderableOptions<ImageRenderable> {
  /** Raw RGBA pixel bytes (length = imageWidth * imageHeight * 4). */
  data: Uint8Array
  imageWidth: number
  imageHeight: number
}

export class ImageRenderable extends Renderable {
  public data: Uint8Array
  public imageWidth: number
  public imageHeight: number
  private cellWidth: number | null = null
  private cellHeight: number | null = null

  constructor(ctx: RenderContext, options: ImageOptions) {
    const renderer = ctx as CliRenderer
    const { data, imageWidth, imageHeight } = options

    const mode = graphicsLayoutMode(renderer)
    const { cellWidth, cellHeight } = getCellSize(renderer, mode)
    const { width, height } = getImageSize(imageWidth, imageHeight, cellWidth, cellHeight, mode)

    super(ctx, { ...options, width, height })
    this.data = data
    this.imageWidth = imageWidth
    this.imageHeight = imageHeight
    this.cellWidth = cellWidth
    this.cellHeight = cellHeight
  }

  public updateCellSize(): void {
    const renderer = this._ctx as CliRenderer
    const mode = graphicsLayoutMode(renderer)
    const { cellWidth, cellHeight } = getCellSize(renderer, mode)
    const { width, height } = getImageSize(this.imageWidth, this.imageHeight, cellWidth, cellHeight, mode)
    this.cellWidth = cellWidth
    this.cellHeight = cellHeight
    this.width = width
    this.height = height
  }

  public setImage(data: Uint8Array, imageWidth: number, imageHeight: number): void {
    this.data = data
    this.imageWidth = imageWidth
    this.imageHeight = imageHeight
    this.updateCellSize()
    this.requestRender()
  }

  public override renderPixels(pixels: PixelBuffer): void {
    if (this.cellWidth == null || this.cellHeight == null) {
      this.updateCellSize()
    }
    // Terminal cursor positions are 1-based; layout x/y are 0-based.
    const x = Math.max(this.x, 0) + 1
    const y = Math.max(this.y, 0) + 1
    pixels.drawImage(x, y, this.imageWidth, this.imageHeight, this.data, this.width, this.height)
  }
}
