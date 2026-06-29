/**
 * rdiff (Rust Myers → WASM) diff loader, with Pierre fallback.
 * Eagerly loads at import time. Falls back to @pierre/diffs parseDiffFromFile.
 */
import { parseDiffFromFile } from "@pierre/diffs"

let _rdiff: { diff_compute(oldText: string, newText: string): string } | null = null

// Eager init
const _init = (() => {
  try {
    const paths = [
      () => require("../../../wasm/core/pkg/rdiff/rdiff.js"),
      () => require("../../wasm/core/pkg/rdiff/rdiff.js"),
    ]
    for (const load of paths) {
      try {
        _rdiff = load() as typeof _rdiff
        return
      } catch {
        // try next
      }
    }
  } catch {
    // rdiff not available
  }
})()

export interface DiffLines {
  deletionLines: string[]
  additionLines: string[]
}

function parseHunks(oldText: string, newText: string, hunks: { type: string; oldStart?: number; newStart?: number; oldEnd?: number; newEnd?: number; length?: number }[]): DiffLines {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const deletionLines: string[] = []
  const additionLines: string[] = []

  for (const hunk of hunks) {
    if (hunk.type === "delete" && hunk.oldStart !== undefined && hunk.oldEnd !== undefined) {
      for (let i = hunk.oldStart; i < hunk.oldEnd; i++) {
        deletionLines.push(oldLines[i] ?? "")
      }
    } else if (hunk.type === "insert" && hunk.newStart !== undefined && hunk.newEnd !== undefined) {
      for (let i = hunk.newStart; i < hunk.newEnd; i++) {
        additionLines.push(newLines[i] ?? "")
      }
    }
  }

  return { deletionLines, additionLines }
}

function pierreFallback(before: string, after: string): DiffLines {
  const r = parseDiffFromFile(
    { name: "before", contents: before },
    { name: "after", contents: after },
  )
  return {
    deletionLines: r.deletionLines ?? [],
    additionLines: r.additionLines ?? [],
  }
}

export function diffLinesSync(before: string, after: string): DiffLines | null {
  if (_rdiff) {
    try {
      const json = _rdiff.diff_compute(before, after)
      if (json && json !== "[]") {
        const hunks = JSON.parse(json)
        return parseHunks(before, after, hunks)
      }
      // Empty diff → try Pierre
    } catch {
      // rdiff failed → fall through to Pierre
    }
  }
  // Fallback: Pierre
  return pierreFallback(before, after)
}
