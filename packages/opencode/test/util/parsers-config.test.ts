import { describe, expect, test } from "bun:test"
import PARSER_CONFIG from "../../parsers-config"

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

  test("every injection target named by a mapping is either registered here or left to the defaults", () => {
    // A mapping pointing at a language that exists nowhere fails exactly as
    // silently as a missing mapping, so the targets are enumerated explicitly
    // rather than assumed.
    const knownDefaults = new Set(["markdown_inline"])
    for (const parser of PARSER_CONFIG.parsers) {
      const nodeTypes = (parser as { injectionMapping?: { nodeTypes?: Record<string, string> } }).injectionMapping
        ?.nodeTypes
      for (const target of Object.values(nodeTypes ?? {})) {
        expect(registered.has(target) || knownDefaults.has(target)).toBe(true)
      }
    }
  })

  test("filetypes are unique", () => {
    const filetypes = PARSER_CONFIG.parsers.map((parser) => parser.filetype)
    expect(new Set(filetypes).size).toBe(filetypes.length)
  })
})
