// Image renderable — RGBA frames via native PixelBuffer → Kitty or Sixel graphics.
//
// Hybrid scroll-lock model (chafa-compatible discipline):
//   1. Layout reserves a cell slot (width × height in terminal cells).
//   2. Cell pass paints that slot (background) so text and graphics share the grid.
//   3. Pixel pass stamps a viewport-clipped fragment scaled to exact slot pixels
//      (cellWidth_px × cellHeight_px × visible cells) at the same screen (x,y).
//   4. Scroll updates translateY on ancestors → this.x/this.y move → same cycle
//      clears the previous footprint and stamps the new one with text.

import {
  isRenderable,
  Renderable,
  type BaseRenderable,
  type RenderableOptions,
} from "../Renderable.js"
import { PixelBuffer, type OptimizedBuffer } from "../buffer.js"
import { RGBA } from "../lib/RGBA.js"
import type { CliRenderer } from "../renderer.js"
import type { RenderContext } from "../types.js"

const DEFAULT_CELL_WIDTH = 18
const DEFAULT_CELL_HEIGHT = 35
const SIXEL_FALLBACK_CELL_WIDTH = 12
const SIXEL_FALLBACK_CELL_HEIGHT = 20

function getCellSize(
  renderer: CliRenderer,
  mode: "kitty" | "sixel" | "none",
): { cellWidth: number | null; cellHeight: number | null } {
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

/** Prefer Kitty when advertised; otherwise Sixel for layout math. */
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
  // Modern Sixel/Kitty map image pixels ≈ screen pixels; layout cells = ceil(px / cellPx).
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
  /** Slot background in the cell layer (under the graphics stamp). */
  backgroundColor?: RGBA
}

export type ClippedImageFrame = {
  data: Uint8Array
  imageWidth: number
  imageHeight: number
  /** 1-based terminal cell column for native stamp. */
  x: number
  /** 1-based terminal cell row for native stamp. */
  y: number
  /** Visible layout width in cells. */
  cellWidth: number
  /** Visible layout height in cells. */
  cellHeight: number
}

export type CellRect = { x: number; y: number; width: number; height: number }

/**
 * Clip an image to a **clip window in terminal cell space** (ScrollBox viewport,
 * not necessarily the full terminal). Then optionally scale the visible fragment
 * so it exactly fills `visibleCells × cellPixel` screen pixels.
 *
 * `viewportWidth`/`viewportHeight` with default origin (0,0) keep older callers
 * working; prefer `clipX`/`clipY`/`clipWidth`/`clipHeight` for inset viewports
 * so stamps do not spill into the prompt/footer.
 */
export function clipImageFrame(input: {
  data: Uint8Array
  imageWidth: number
  imageHeight: number
  layoutX: number
  layoutY: number
  layoutWidth: number
  layoutHeight: number
  /** @deprecated use clipWidth — size of clip window (origin clipX). */
  viewportWidth: number
  /** @deprecated use clipHeight — size of clip window (origin clipY). */
  viewportHeight: number
  /** Clip window origin in terminal cells (default 0 = full terminal). */
  clipX?: number
  clipY?: number
  clipWidth?: number
  clipHeight?: number
  /** When set, scale the clipped fragment to exact slot pixel size. */
  cellPixelWidth?: number
  cellPixelHeight?: number
}): ClippedImageFrame | null {
  if (
    !Number.isFinite(input.layoutWidth) ||
    !Number.isFinite(input.layoutHeight) ||
    input.layoutWidth < 1 ||
    input.layoutHeight < 1
  ) {
    return null
  }
  const x = Math.floor(input.layoutX)
  const y = Math.floor(input.layoutY)
  const clipX = Math.floor(input.clipX ?? 0)
  const clipY = Math.floor(input.clipY ?? 0)
  const clipW = Math.floor(input.clipWidth ?? input.viewportWidth)
  const clipH = Math.floor(input.clipHeight ?? input.viewportHeight)
  if (clipW < 1 || clipH < 1) return null

  // Visible portion of the image slot relative to the image origin (layout cells).
  const left = Math.max(0, clipX - x)
  const top = Math.max(0, clipY - y)
  const right = Math.min(input.layoutWidth, clipX + clipW - x)
  const bottom = Math.min(input.layoutHeight, clipY + clipH - y)
  if (right <= left || bottom <= top) return null

  const visibleCellsW = right - left
  const visibleCellsH = bottom - top

  const pxLeft = Math.round((left / input.layoutWidth) * input.imageWidth)
  const pxRight = Math.round((right / input.layoutWidth) * input.imageWidth)
  const pxTop = Math.round((top / input.layoutHeight) * input.imageHeight)
  const pxBottom = Math.round((bottom / input.layoutHeight) * input.imageHeight)
  let imageWidth = Math.max(1, pxRight - pxLeft)
  let imageHeight = Math.max(1, pxBottom - pxTop)

  let data: Uint8Array
  if (pxLeft === 0 && pxTop === 0 && imageWidth === input.imageWidth && imageHeight === input.imageHeight) {
    data = input.data
  } else {
    data = new Uint8Array(imageWidth * imageHeight * 4)
    for (let row = 0; row < imageHeight; row++) {
      const sourceStart = ((pxTop + row) * input.imageWidth + pxLeft) * 4
      data.set(input.data.subarray(sourceStart, sourceStart + imageWidth * 4), row * imageWidth * 4)
    }
  }

  // Stamp must fill the reserved cell rect in screen pixels so scroll moves
  // graphics by exact cell steps with text.
  const cellPxW = Math.max(1, Math.round(input.cellPixelWidth ?? 0))
  const cellPxH = Math.max(1, Math.round(input.cellPixelHeight ?? 0))
  if (cellPxW > 0 && cellPxH > 0 && input.cellPixelWidth && input.cellPixelHeight) {
    const targetW = visibleCellsW * cellPxW
    const targetH = visibleCellsH * cellPxH
    if (targetW !== imageWidth || targetH !== imageHeight) {
      data = scaleRgbaNearest(data, imageWidth, imageHeight, targetW, targetH)
      imageWidth = targetW
      imageHeight = targetH
    }
  }

  return {
    data,
    imageWidth,
    imageHeight,
    x: x + left + 1,
    y: y + top + 1,
    cellWidth: visibleCellsW,
    cellHeight: visibleCellsH,
  }
}

/** Intersect two cell rectangles; empty if no overlap. */
export function intersectCellRect(a: CellRect, b: CellRect): CellRect | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const width = x2 - x1
  const height = y2 - y1
  if (width < 1 || height < 1) return null
  return { x: x1, y: y1, width, height }
}

/** Nearest-neighbor RGBA scale — deterministic, no extra deps. */
export function scaleRgbaNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return src
  const out = new Uint8Array(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW))
      const si = (sy * srcW + sx) * 4
      const di = (y * dstW + x) * 4
      out[di] = src[si]!
      out[di + 1] = src[si + 1]!
      out[di + 2] = src[si + 2]!
      out[di + 3] = src[si + 3]!
    }
  }
  return out
}

export class ImageRenderable extends Renderable {
  public data: Uint8Array
  public imageWidth: number
  public imageHeight: number
  private cellWidth: number | null = null
  private cellHeight: number | null = null
  private _slotBackground: RGBA

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
    this._slotBackground = options.backgroundColor ?? RGBA.fromValues(0, 0, 0, 1)
    // Constructor may leave _widthValue unset if options clobbered dimensions;
    // pin draw-time size immediately.
    this.applySlotSize(width, height)
  }

  public updateCellSize(): void {
    const renderer = this._ctx as CliRenderer
    const mode = graphicsLayoutMode(renderer)
    const { cellWidth, cellHeight } = getCellSize(renderer, mode)
    const { width, height } = getImageSize(this.imageWidth, this.imageHeight, cellWidth, cellHeight, mode)
    this.cellWidth = cellWidth
    this.cellHeight = cellHeight
    // Force numeric yoga size every time metrics refresh so flex parents cannot
    // collapse the slot to 1 row (single-line Sixel stamp).
    this.applySlotSize(width, height)
  }

  /** Keep layout slot = ceil(imagePx / cellPx) and non-NaN draw sizes. */
  private applySlotSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    this._width = w
    this._height = h
    this._widthValue = w
    this._heightValue = h
    this.yogaNode.setWidth(w)
    this.yogaNode.setHeight(h)
    this.yogaNode.setFlexShrink(0)
    this.requestRender()
  }

  protected override onLayoutResize(width: number, height: number): void {
    // If Yoga collapsed or poisoned the slot, re-assert pixel-derived size.
    const renderer = this._ctx as CliRenderer
    const mode = graphicsLayoutMode(renderer)
    const { cellWidth, cellHeight } = getCellSize(renderer, mode)
    const expected = getImageSize(this.imageWidth, this.imageHeight, cellWidth, cellHeight, mode)
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < expected.width ||
      height < expected.height
    ) {
      this.applySlotSize(expected.width, expected.height)
      return
    }
    super.onLayoutResize(width, height)
  }

  public setImage(data: Uint8Array, imageWidth: number, imageHeight: number): void {
    this.data = data
    this.imageWidth = imageWidth
    this.imageHeight = imageHeight
    this.updateCellSize()
    this.requestRender()
  }

  /**
   * Cell layer: own the reserved slot so text and graphics share one grid.
   * Only the visible intersection with the terminal is filled (scroll-safe).
   */
  protected override renderSelf(buffer: OptimizedBuffer, _deltaTime: number): void {
    const renderer = this._ctx as CliRenderer
    const slot = this.slotCells()
    const clip = this.ancestorClipRect(renderer.width, renderer.height)
    if (!clip) return
    const layoutX = Math.floor(this.x)
    const layoutY = Math.floor(this.y)
    const left = Math.max(0, clip.x - layoutX)
    const top = Math.max(0, clip.y - layoutY)
    const right = Math.min(slot.width, clip.x + clip.width - layoutX)
    const bottom = Math.min(slot.height, clip.y + clip.height - layoutY)
    if (right <= left || bottom <= top) return
    buffer.fillRect(layoutX + left, layoutY + top, right - left, bottom - top, this._slotBackground)
  }

  /** Prefer explicit pixel-derived size over a poisoned/collapsed layout value. */
  private slotCells(): { width: number; height: number } {
    const mode = graphicsLayoutMode(this._ctx as CliRenderer)
    const expected = getImageSize(this.imageWidth, this.imageHeight, this.cellWidth, this.cellHeight, mode)
    const w = Number.isFinite(this.width) && this.width >= 1 ? Math.max(this.width, expected.width) : expected.width
    const h = Number.isFinite(this.height) && this.height >= 1 ? Math.max(this.height, expected.height) : expected.height
    if (w !== this._widthValue || h !== this._heightValue) {
      this.applySlotSize(w, h)
    }
    return { width: w, height: h }
  }

  /**
   * Clip window = full terminal intersected with every overflow:hidden ancestor
   * (ScrollBox viewport). Prevents Sixel stamps from spilling into the prompt.
   */
  private ancestorClipRect(terminalW: number, terminalH: number): CellRect | null {
    let clip: CellRect | null = { x: 0, y: 0, width: terminalW, height: terminalH }
    let node: BaseRenderable | null = this.parent
    while (node && clip) {
      if (isRenderable(node) && node.overflow !== "visible" && node.width > 0 && node.height > 0) {
        const ancestor: CellRect = {
          x: Math.floor(node.screenX),
          y: Math.floor(node.screenY),
          width: Math.floor(node.width),
          height: Math.floor(node.height),
        }
        clip = intersectCellRect(clip, ancestor)
      }
      node = node.parent
    }
    return clip
  }

  /**
   * Pixel layer: stamp viewport-clipped fragment into the same cell slot.
   * Coordinates follow this.x/this.y (includes ScrollBox translateY).
   * Clip uses ScrollBox viewport bounds so graphics never cross the input box.
   */
  public override renderPixels(pixels: PixelBuffer): void {
    if (this.cellWidth == null || this.cellHeight == null) {
      this.updateCellSize()
    }
    const renderer = this._ctx as CliRenderer
    const mode = graphicsLayoutMode(renderer)
    const { cellWidth: cellPxW, cellHeight: cellPxH } = getCellSize(renderer, mode)
    const slot = this.slotCells()
    const clip = this.ancestorClipRect(renderer.width, renderer.height)
    if (!clip) return
    const frame = clipImageFrame({
      data: this.data,
      imageWidth: this.imageWidth,
      imageHeight: this.imageHeight,
      layoutX: this.x,
      layoutY: this.y,
      layoutWidth: slot.width,
      layoutHeight: slot.height,
      viewportWidth: clip.width,
      viewportHeight: clip.height,
      clipX: clip.x,
      clipY: clip.y,
      clipWidth: clip.width,
      clipHeight: clip.height,
      cellPixelWidth: cellPxW ?? this.cellWidth ?? undefined,
      cellPixelHeight: cellPxH ?? this.cellHeight ?? undefined,
    })
    if (!frame) return
    pixels.drawImage(
      frame.x,
      frame.y,
      frame.imageWidth,
      frame.imageHeight,
      frame.data,
      frame.cellWidth,
      frame.cellHeight,
    )
  }
}
