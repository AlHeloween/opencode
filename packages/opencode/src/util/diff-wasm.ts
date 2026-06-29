export interface DiffHunk {
  type: "equal" | "delete" | "insert"
  oldStart?: number
  newStart?: number
  oldEnd?: number
  newEnd?: number
  length?: number
}

type DiffyModule = {
  diff_create_patch(original: string, modified: string): string
  diff_apply(base: string, patch_text: string): string
  diff_parse(patch_text: string): string
  diff_stats(original: string, modified: string): string
}

let _diffy: DiffyModule | null = null
let _initPromise: Promise<DiffyModule | null> | null = null

async function loadDiffy(): Promise<DiffyModule | null> {
  if (_diffy) return _diffy
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const paths = [
      new URL("../../wasm/core/pkg/diffy/diffy_wasm.js", import.meta.url).href,
      new URL("../../../wasm/core/pkg/diffy/diffy_wasm.js", import.meta.url).href,
      new URL("../../../../packages/wasm/core/pkg/diffy/diffy_wasm.js", import.meta.url).href,
    ]
    for (const url of paths) {
      try {
        const mod = await import(url)
        const diffyMod = mod as DiffyModule
        if (typeof diffyMod.diff_create_patch === "function") {
          _diffy = diffyMod
          return diffyMod
        }
      } catch { /* try next path */ }
    }
    return null
  })()
  return _initPromise
}

/** Create a unified diff patch between original and modified text. */
export async function createPatch(original: string, modified: string): Promise<string | null> {
  const d = await loadDiffy()
  if (!d) return null
  try {
    const patch = d.diff_create_patch(original, modified)
    return trimPatch(patch)
  } catch { return null }
}

/** Apply a unified diff patch to base text. Returns patched text or null. */
export async function applyPatch(base: string, patchText: string): Promise<string | null> {
  const d = await loadDiffy()
  if (!d) return null
  try {
    return d.diff_apply(base, patchText)
  } catch { return null }
}

/** Parse unified diff text into structured hunks JSON. */
export async function parsePatch(patchText: string): Promise<string | null> {
  const d = await loadDiffy()
  if (!d) return null
  try {
    const json = d.diff_parse(patchText)
    return json === "[]" ? null : json
  } catch { return null }
}

/** Count additions and deletions between two texts. */
export async function diffStats(original: string, modified: string): Promise<{ additions: number; deletions: number } | null> {
  const d = await loadDiffy()
  if (!d) return null
  try {
    const json = d.diff_stats(original, modified)
    return JSON.parse(json) as { additions: number; deletions: number }
  } catch { return null }
}

/** Compute line-level hunks between two texts. */
export async function computeDiffWasm(oldText: string, newText: string): Promise<DiffHunk[] | null> {
  const d = await loadDiffy()
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
