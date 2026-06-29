export interface DiffHunk {
  type: "equal" | "delete" | "insert"
  oldStart?: number
  newStart?: number
  oldEnd?: number
  newEnd?: number
  length?: number
}

let _diffy: {
  diff_create_patch(original: string, modified: string): string
  diff_apply(base: string, patch_text: string): string
  diff_parse(patch_text: string): string
  diff_stats(original: string, modified: string): string
} | null = null
let _initFailed = false

function loadDiffy() {
  if (_diffy) return _diffy
  if (_initFailed) return null
  try {
    const paths = [
      () => require("../../../wasm/core/pkg/diffy/diffy_wasm.js"),
      () => require("../../wasm/core/pkg/diffy/diffy_wasm.js"),
      () => require("../../../../packages/wasm/core/pkg/diffy/diffy_wasm.js"),
    ]
    for (const load of paths) {
      try {
        _diffy = load() as typeof _diffy
        return _diffy
      } catch { /* try next */ }
    }
  } catch { /* all failed */ }
  _initFailed = true
  return null
}

/** Create a unified diff patch between original and modified text. */
export function createPatch(original: string, modified: string): string | null {
  const d = loadDiffy()
  if (!d) return null
  try {
    const patch = d.diff_create_patch(original, modified)
    return trimPatch(patch)
  } catch { return null }
}

/** Apply a unified diff patch to base text. Returns patched text or null. */
export function applyPatch(base: string, patchText: string): string | null {
  const d = loadDiffy()
  if (!d) return null
  try {
    return d.diff_apply(base, patchText)
  } catch { return null }
}

/** Parse unified diff text into structured hunks JSON. */
export function parsePatch(patchText: string): string | null {
  const d = loadDiffy()
  if (!d) return null
  try {
    const json = d.diff_parse(patchText)
    return json === "[]" ? null : json
  } catch { return null }
}

/** Count additions and deletions between two texts. */
export function diffStats(original: string, modified: string): { additions: number; deletions: number } | null {
  const d = loadDiffy()
  if (!d) return null
  try {
    const json = d.diff_stats(original, modified)
    return JSON.parse(json) as { additions: number; deletions: number }
  } catch { return null }
}

/** Compute line-level hunks between two texts. */
export function computeDiffWasm(oldText: string, newText: string): DiffHunk[] | null {
  const d = loadDiffy()
  if (!d) return null
  try {
    const json = d.diff_parse(d.diff_create_patch(oldText, newText))
    if (!json || json === "[]") return []
    return JSON.parse(json) as DiffHunk[]
  } catch { return null }
}

/** Strip trailing "\ No newline at end of file" markers and extra whitespace from patch. */
function trimPatch(patch: string): string {
  return patch
    .split("\n")
    .filter((l) => !l.startsWith("\\ No newline"))
    .join("\n")
    .trimEnd() + "\n"
}

export * as DiffWasmMod from "./diff-wasm"
