/**
 * Compute a line-based unified diff between two strings.
 * Returns git-format diff with ---/+++ headers and hunks.
 *
 * Extracted from src/provider/gateway/adaptive-client.ts to shared utility
 * so both the gateway and request-diff can use it.
 */
export function unifiedDiff(prev: string, curr: string, prevLabel: string, currLabel: string): string {
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

  const totalChanges = added + removed
  const unchanged = hunkLines.filter((l) => l.startsWith(" ")).length
  const pctChanged = Math.round((totalChanges / Math.max(1, totalChanges + unchanged)) * 100)

  out.push(`@@ -0,0 +0,0 @@ ${added} added, ${removed} removed, ${pctChanged}% changed`)
  out.push(...hunkLines.slice(0, 100)) // Cap at 100 lines to keep files manageable
  if (hunkLines.length > 100) {
    out.push(`... (${hunkLines.length - 100} more lines omitted)`)
  }

  return out.join("\n")
}
