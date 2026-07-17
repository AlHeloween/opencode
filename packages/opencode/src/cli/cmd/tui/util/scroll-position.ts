/**
 * Pure helpers for session chat scroll UX (position label + live edge).
 * Kept free of OpenTUI renderables so unit tests stay hermetic.
 */

export type ScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}

export type ScrollPositionInfo = {
  /** True when content fits or the viewport is at the sticky live edge. */
  atLive: boolean
  /** 0–100 progress through scrollable range (100 when at live / no overflow). */
  percent: number
  /** How many content rows sit above the current viewport top. */
  rowsAbove: number
  /** How many content rows sit below the current viewport bottom. */
  rowsBelow: number
  maxScroll: number
}

/** Max distance from bottom still treated as "live" (matches OpenTUI re-engage). */
export const LIVE_EDGE_TOLERANCE = 1

export function scrollMax(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.viewportHeight)
}

export function isAtLiveEdge(metrics: ScrollMetrics, tolerance = LIVE_EDGE_TOLERANCE): boolean {
  const max = scrollMax(metrics)
  if (max <= 0) return true
  return metrics.scrollTop >= max - tolerance
}

export function computeScrollPosition(metrics: ScrollMetrics): ScrollPositionInfo {
  const maxScroll = scrollMax(metrics)
  const top = Math.max(0, Math.min(metrics.scrollTop, maxScroll || metrics.scrollTop))
  const atLive = isAtLiveEdge({ ...metrics, scrollTop: top })
  const percent =
    maxScroll <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((top / maxScroll) * 100)))
  const rowsAbove = maxScroll <= 0 ? 0 : top
  const rowsBelow = maxScroll <= 0 ? 0 : Math.max(0, maxScroll - top)
  return { atLive, percent, rowsAbove, rowsBelow, maxScroll }
}

/**
 * Short status line for the jump-to-live chip.
 * Example: "↓ Live · 42% · 120 above"
 */
export function formatScrollChip(info: ScrollPositionInfo): string {
  if (info.atLive) return "↓ Live"
  const above =
    info.rowsAbove >= 1000
      ? `${(info.rowsAbove / 1000).toFixed(1)}k above`
      : `${info.rowsAbove} above`
  return `↓ Live · ${info.percent}% · ${above}`
}

/** Count message nodes whose layout y is above the viewport top (+ padding). */
export function countMessagesAbove(
  messageYs: number[],
  viewportTopY: number,
  pad = 0,
): number {
  return messageYs.filter((y) => y < viewportTopY - pad).length
}
