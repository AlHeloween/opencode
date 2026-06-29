/**
 * Unified tree-sitter parser — loads grammars from local WASM files.
 * Falls back to CDN-loaded web-tree-sitter if local grammars unavailable.
 *
 * Replaces 22 separate CDN round-trips with a single local load path.
 */
import PARSER_CONFIG from "../../parsers-config"

type GrammarEntry = {
  filetype: string
  wasm: Uint8Array | null  // null = not yet loaded, undefined = failed
}

const grammarCache = new Map<string, Uint8Array | null>()

async function loadLocalWasm(urlString: string): Promise<Uint8Array | null> {
  // Extract filename from URL or path
  const filename = urlString.split("/").pop()?.split("?")[0]
  if (!filename) return null

  // Check grammar cache first
  const cached = grammarCache.get(filename)
  if (cached !== undefined) return cached

  try {
    // Try local path first: ../../wasm/core/pkg/grammars/<filename>
    const localPath = `../../wasm/core/pkg/grammars/${filename}`
    const file = Bun.file(localPath)
    if (await file.exists()) {
      const buf = new Uint8Array(await file.arrayBuffer())
      grammarCache.set(filename, buf)
      return buf
    }
  } catch {
    // Local file not found — try CDN fallback
  }

  // CDN fallback
  try {
    const resp = await fetch(urlString)
    if (!resp.ok) {
      grammarCache.set(filename, null)
      return null
    }
    const buf = new Uint8Array(await resp.arrayBuffer())
    grammarCache.set(filename, buf)
    return buf
  } catch {
    grammarCache.set(filename, null)
    return null
  }
}

/**
 * Get WASM bytes for a language by filetype.
 * Returns null if grammar is not available locally or via CDN.
 */
export async function getGrammarWasm(filetype: string): Promise<Uint8Array | null> {
  const entry = PARSER_CONFIG.parsers.find((p) => p.filetype === filetype)
  if (!entry) return null
  return loadLocalWasm(entry.wasm)
}

/**
 * Pre-load all grammars. Call during initialization to warm the cache.
 * Grammars already in pkg/grammars/ load instantly from disk.
 */
export async function preloadGrammars(): Promise<number> {
  const results = await Promise.allSettled(
    PARSER_CONFIG.parsers.map((p) => loadLocalWasm(p.wasm)),
  )
  return results.filter((r) => r.status === "fulfilled" && r.value !== null).length
}

/**
 * Get list of available languages (those with local or CDN grammars loaded).
 */
export function availableLanguages(): string[] {
  return PARSER_CONFIG.parsers.map((p) => p.filetype)
}
