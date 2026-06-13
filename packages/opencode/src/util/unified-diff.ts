/**
 * Compute a line-based unified diff between two strings.
 * Returns git-format diff with ---/+++ headers and hunks.
 *
 * Extracted from src/provider/gateway/adaptive-client.ts to shared utility
 * so both the gateway and request-diff can use it.
 */
export interface DiffOptions {
  /**
   * Number of identical context lines to keep on each side of a change.
   * Runs of context lines longer than `2 * contextLines` are collapsed
   * into a "... N identical lines skipped ..." marker.
   *
   * Default: `0` — keep all context lines (no collapsing).
   */
  contextLines?: number
  /** Maximum total output lines. Default: `100`. Set to `0` for unlimited. */
  maxLines?: number
}

export function unifiedDiff(
  prev: string,
  curr: string,
  prevLabel: string,
  currLabel: string,
  options?: DiffOptions,
): string {
  const contextLines = options?.contextLines ?? 0
  const maxLines = options?.maxLines ?? 100

  const pLines = prev.split("\n")
  const cLines = curr.split("\n")
  const out: string[] = []

  out.push(`--- ${prevLabel}`)
  out.push(`+++ ${currLabel}`)

  // Count changes for the stats line
  let added = 0
  let removed = 0
  const hunkLines: string[] = []
  let i = 0
  let j = 0

  while (i < pLines.length || j < cLines.length) {
    if (i < pLines.length && j < cLines.length && pLines[i] === cLines[j]) {
      hunkLines.push(` ${pLines[i]}`)
      i++
      j++
      continue
    }

    // Find next sync point within a window
    let syncP = -1
    let syncC = -1
    const window = 30
    for (let si = i; si < Math.min(i + window, pLines.length) && syncP === -1; si++) {
      for (let sj = j; sj < Math.min(j + window, cLines.length); sj++) {
        if (pLines[si] === cLines[sj]) {
          syncP = si
          syncC = sj
          break
        }
      }
    }

    if (syncP >= 0) {
      for (let k = i; k < syncP; k++) {
        hunkLines.push(`-${pLines[k]}`)
        removed++
      }
      for (let k = j; k < syncC; k++) {
        hunkLines.push(`+${cLines[k]}`)
        added++
      }
      i = syncP
      j = syncC
    } else {
      for (let k = i; k < pLines.length; k++) {
        hunkLines.push(`-${pLines[k]}`)
        removed++
      }
      for (let k = j; k < cLines.length; k++) {
        hunkLines.push(`+${cLines[k]}`)
        added++
      }
      break
    }
  }

  // Build final output with optional context-window collapsing
  const totalChanges = added + removed
  const unchangedLines = hunkLines.filter((l) => l.startsWith(" ")).length
  const pctChanged = Math.round((totalChanges / Math.max(1, totalChanges + unchangedLines)) * 100)

  out.push(
    `@@ -0,0 +0,0 @@ ${added} added, ${removed} removed, ${pctChanged}% changed`,
  )

  if (contextLines > 0) {
    // Collapse large runs of identical context lines
    const collapsed = collapseContextRuns(hunkLines, contextLines)
    const effectiveMax = maxLines > 0 ? maxLines : collapsed.length
    out.push(...collapsed.slice(0, effectiveMax))
    if (effectiveMax < collapsed.length) {
      out.push(`... (${collapsed.length - effectiveMax} more lines omitted)`)
    }
  } else {
    // Legacy behavior: flat output with simple cap
    const effectiveMax = maxLines > 0 ? maxLines : hunkLines.length
    out.push(...hunkLines.slice(0, effectiveMax))
    if (effectiveMax < hunkLines.length) {
      out.push(`... (${hunkLines.length - effectiveMax} more lines omitted)`)
    }
  }

  return out.join("\n")
}

/**
 * Collapse runs of identical context lines longer than `2 * contextLines`
 * into a skip marker. Context lines adjacent to changes are always preserved.
 */
function collapseContextRuns(lines: string[], contextLines: number): string[] {
  const n = lines.length

  // Mark lines as "change" (- or + prefix) vs "context" (space prefix)
  const isChange = lines.map((l) => l.startsWith("-") || l.startsWith("+"))

  // For each line, determine distance to nearest change
  const prevChange = new Int32Array(n)
  const nextChange = new Int32Array(n)

  let last = -Infinity
  for (let i = 0; i < n; i++) {
    if (isChange[i]) last = i
    prevChange[i] = i - last
  }

  last = Infinity
  for (let i = n - 1; i >= 0; i--) {
    if (isChange[i]) last = i
    nextChange[i] = last - i
  }

  // Build collapsed output
  const result: string[] = []
  let runStart = -1

  for (let i = 0; i < n; i++) {
    // Keep if it's a change, or close enough to a change
    if (isChange[i] || prevChange[i] <= contextLines || nextChange[i] <= contextLines) {
      // Flush any pending skip run
      if (runStart >= 0) {
        const count = i - runStart
        result.push(`... (${count} identical context lines skipped)`)
        runStart = -1
      }
      result.push(lines[i])
    } else {
      // Part of a run to skip
      if (runStart < 0) runStart = i
    }
  }

  // Flush trailing skip run
  if (runStart >= 0) {
    const count = n - runStart
    result.push(`... (${count} identical context lines skipped)`)
  }

  return result
}
