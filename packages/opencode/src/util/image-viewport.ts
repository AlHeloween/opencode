/**
 * Zoom/pan viewport over an RGBA source image.
 *
 * Used by interactive mermaid (and other MediaImage) diagrams: fixed display
 * size, mouse-wheel zoom, drag pan. Sampling is nearest-neighbor (fast enough
 * for terminal-sized outputs).
 */

export type ViewportState = {
  /** Magnification over contain-fit (≥ 1). */
  zoom: number
  /** Pan in source pixels (positive = show content further right/down). */
  panX: number
  panY: number
}

export type CropRect = {
  x0: number
  y0: number
  cropW: number
  cropH: number
}

const MIN_ZOOM = 1
const MAX_ZOOM = 12

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * Region of the source image visible in an outW×outH viewport at zoom/pan.
 * At zoom=1 the crop is the full contain-fit of the source into the viewport
 * (letterboxed region is handled by sampling with a background fill outside
 * the crop — caller can pass a solid bg).
 */
export function viewportCrop(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
  state: ViewportState,
): CropRect {
  const sw = Math.max(1, srcWidth)
  const sh = Math.max(1, srcHeight)
  const ow = Math.max(1, outWidth)
  const oh = Math.max(1, outHeight)
  const zoom = clampZoom(state.zoom)

  // Contain-fit scale at zoom 1: source → display
  const fit = Math.min(ow / sw, oh / sh)
  const scale = fit * zoom // display pixels per source pixel
  // Visible source region
  let cropW = Math.min(sw, ow / scale)
  let cropH = Math.min(sh, oh / scale)
  cropW = Math.max(1, cropW)
  cropH = Math.max(1, cropH)

  // Center + pan, clamped so crop stays inside source
  const maxX0 = Math.max(0, sw - cropW)
  const maxY0 = Math.max(0, sh - cropH)
  const cx = sw / 2 + state.panX
  const cy = sh / 2 + state.panY
  let x0 = cx - cropW / 2
  let y0 = cy - cropH / 2
  x0 = Math.min(maxX0, Math.max(0, x0))
  y0 = Math.min(maxY0, Math.max(0, y0))

  return { x0, y0, cropW, cropH }
}

/** Clamp pan so the crop stays within the source for the given zoom. */
export function clampPan(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
  state: ViewportState,
): ViewportState {
  const zoom = clampZoom(state.zoom)
  const crop = viewportCrop(srcWidth, srcHeight, outWidth, outHeight, { ...state, zoom })
  // Max pan from center such that crop still fits
  const maxPanX = Math.max(0, (srcWidth - crop.cropW) / 2)
  const maxPanY = Math.max(0, (srcHeight - crop.cropH) / 2)
  return {
    zoom,
    panX: Math.min(maxPanX, Math.max(-maxPanX, state.panX)),
    panY: Math.min(maxPanY, Math.max(-maxPanY, state.panY)),
  }
}

/**
 * Sample src RGBA into a new outW×outH buffer for the viewport.
 * Nearest-neighbor. Background fill when letterboxing (zoom=1, aspect mismatch).
 */
export function sampleViewport(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
  state: ViewportState,
  bg: [number, number, number, number] = [250, 250, 252, 255],
): Uint8Array {
  const crop = viewportCrop(srcWidth, srcHeight, outWidth, outHeight, state)
  const out = new Uint8Array(outWidth * outHeight * 4)

  // Map each output pixel into the crop rectangle in source space.
  // Letterbox: if crop aspect differs from out, center the mapped region.
  const zoom = clampZoom(state.zoom)
  const fit = Math.min(outWidth / Math.max(1, srcWidth), outHeight / Math.max(1, srcHeight))
  const scale = fit * zoom
  // Size of the mapped source region in output pixels
  const mappedW = crop.cropW * scale
  const mappedH = crop.cropH * scale
  const offX = (outWidth - mappedW) / 2
  const offY = (outHeight - mappedH) / 2

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const oi = (y * outWidth + x) * 4
      const u = (x - offX) / mappedW
      const v = (y - offY) / mappedH
      if (u < 0 || u > 1 || v < 0 || v > 1 || mappedW <= 0 || mappedH <= 0) {
        out[oi] = bg[0]
        out[oi + 1] = bg[1]
        out[oi + 2] = bg[2]
        out[oi + 3] = bg[3]
        continue
      }
      const sx = Math.min(srcWidth - 1, Math.max(0, Math.floor(crop.x0 + u * crop.cropW)))
      const sy = Math.min(srcHeight - 1, Math.max(0, Math.floor(crop.y0 + v * crop.cropH)))
      const si = (sy * srcWidth + sx) * 4
      out[oi] = src[si]!
      out[oi + 1] = src[si + 1]!
      out[oi + 2] = src[si + 2]!
      out[oi + 3] = src[si + 3] ?? 255
    }
  }
  return out
}

/** Apply wheel delta: zoom in (up) / out (down). Returns new state (pan clamped). */
export function zoomByWheel(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
  state: ViewportState,
  direction: "up" | "down" | "left" | "right",
  factor = 1.2,
): ViewportState {
  const nextZoom =
    direction === "up" || direction === "left"
      ? clampZoom(state.zoom * factor)
      : clampZoom(state.zoom / factor)
  // Reset pan when returning to fit
  if (nextZoom <= MIN_ZOOM) {
    return { zoom: MIN_ZOOM, panX: 0, panY: 0 }
  }
  return clampPan(srcWidth, srcHeight, outWidth, outHeight, {
    zoom: nextZoom,
    panX: state.panX,
    panY: state.panY,
  })
}

/**
 * Pan by terminal-cell drag delta.
 * dx/dy are cell deltas (mouse move in columns/rows).
 * Converted to source pixels using crop size / display cell size.
 */
export function panByCells(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
  state: ViewportState,
  dxCells: number,
  dyCells: number,
  layoutCols: number,
  layoutRows: number,
): ViewportState {
  const crop = viewportCrop(srcWidth, srcHeight, outWidth, outHeight, state)
  const cols = Math.max(1, layoutCols)
  const rows = Math.max(1, layoutRows)
  // Dragging content right → pan left (show left of image)
  const panX = state.panX - (dxCells * crop.cropW) / cols
  const panY = state.panY - (dyCells * crop.cropH) / rows
  return clampPan(srcWidth, srcHeight, outWidth, outHeight, {
    zoom: state.zoom,
    panX,
    panY,
  })
}
