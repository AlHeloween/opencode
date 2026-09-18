import { describe, expect, test } from "bun:test"
import PARSER_CONFIG from "../../parsers-config"
import { embeddedQueryPath } from "../../src/util/wasm-embedded-queries"

/**
 * A grammar that injects another language must declare the mapping that names it.
 *
 * The worker resolves an injected node's language ONLY through
 * `injectionMapping.nodeTypes` — it never reads the
 * `(#set! injection.language ...)` the query itself declares. With no mapping
 * the injection is skipped silently: nothing warns, nothing logs, nothing goes
 * red. The inline markdown layer was absent that way — `**bold**` kept its
 * markers and its weight, inline backticks stayed visible — while block
 * colouring and fenced code blocks looked perfectly healthy, because fences take
 * a different branch that reads the info string (2026-09-18).
 *
 * `addDefaultParsers` REPLACES an entry by filetype rather than merging, so
 * opencode registering its own markdown parser dropped OpenTUI's mapping along
 * with it. Overriding a default is therefore a promise to carry everything the
 * default carried.
 */

const registered = new Set(PARSER_CONFIG.parsers.map((parser) => parser.filetype))

function nodeTypesOf(filetype: string): Record<string, string> | undefined {
  const entry = PARSER_CONFIG.parsers.find((parser) => parser.filetype === filetype)
  return (entry as { injectionMapping?: { nodeTypes?: Record<string, string> } } | undefined)?.injectionMapping
    ?.nodeTypes
}

function infoStringMapOf(filetype: string): Record<string, string> | undefined {
  const entry = PARSER_CONFIG.parsers.find((parser) => parser.filetype === filetype)
  return (entry as { injectionMapping?: { infoStringMap?: Record<string, string> } } | undefined)?.injectionMapping
    ?.infoStringMap
}

describe("parsers-config", () => {
  test("markdown maps its inline node types to markdown_inline", () => {
    const nodeTypes = nodeTypesOf("markdown")
    expect(nodeTypes).toBeDefined()
    expect(nodeTypes!["inline"]).toBe("markdown_inline")
    expect(nodeTypes!["pipe_table_cell"]).toBe("markdown_inline")
  })

  test("markdown_inline is NOT overridden here — OpenTUI's bundled entry serves it", () => {
    // Registering it locally replaced a bundled, offline-safe query with one
    // fetched from GitHub at runtime. The default is already registered for
    // every filetype this config does not override, so overriding it bought
    // nothing and cost the local asset.
    expect(registered.has("markdown_inline")).toBe(false)
  })

  test("markdown maps short info-string aliases to canonical filetypes", () => {
    // The worker falls back to the literal info string when this map has no
    // entry, and a bare alias (`ts`, `js`) is not a registered filetype — the
    // fence loses highlighting with only `bug: No parser found for injection
    // language: ts` in the log (2026-09-18). OpenTUI's default markdown entry
    // carried the map; the override must carry it too.
    const infoStringMap = infoStringMapOf("markdown")
    expect(infoStringMap).toBeDefined()
    expect(infoStringMap!["ts"]).toBe("typescript")
    expect(infoStringMap!["js"]).toBe("javascript")
    expect(infoStringMap!["md"]).toBe("markdown")
  })

  test("every injection target named by a mapping is either registered here or left to the defaults", () => {
    // A mapping pointing at a language that exists nowhere fails exactly as
    // silently as a missing mapping, so the targets are enumerated explicitly
    // rather than assumed.
    const knownDefaults = new Set([
      "markdown_inline",
      "javascript",
      "javascriptreact",
      "typescript",
      "typescriptreact",
    ])
    for (const parser of PARSER_CONFIG.parsers) {
      const mapping = (parser as { injectionMapping?: { nodeTypes?: Record<string, string>; infoStringMap?: Record<string, string> } })
        .injectionMapping
      for (const target of [
        ...Object.values(mapping?.nodeTypes ?? {}),
        ...Object.values(mapping?.infoStringMap ?? {}),
      ]) {
        expect(registered.has(target) || knownDefaults.has(target)).toBe(true)
      }
    }
  })

  test("every query URL is embedded — no runtime download", () => {
    // The worker falls back to the URL when the map has no entry, which means a
    // network fetch on first use and a cache write under the OpenTUI data path.
    // The map is generated from these very URLs by script/fetch-queries.ts, so a
    // missing entry means a dead URL: `bat`'s nvim-treesitter path 404s upstream
    // (allowlisted below; the runtime 404s identically, so nothing regresses).
    const knownDead = new Set([
      "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/batch/highlights.scm",
    ])
    const urls: string[] = []
    for (const parser of PARSER_CONFIG.parsers) {
      const queries = parser.queries as { highlights?: string[]; injections?: string[] }
      urls.push(...(queries.highlights ?? []), ...(queries.injections ?? []))
    }
    const missing = urls.filter((url) => !embeddedQueryPath(url) && !knownDead.has(url))
    expect(missing).toEqual([])
  })

  test("filetypes are unique", () => {
    const filetypes = PARSER_CONFIG.parsers.map((parser) => parser.filetype)
    expect(new Set(filetypes).size).toBe(filetypes.length)
  })
})
