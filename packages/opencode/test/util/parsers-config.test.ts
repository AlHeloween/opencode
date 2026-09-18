import { describe, expect, test } from "bun:test"
import PARSER_CONFIG from "../../parsers-config"

/**
 * A grammar that injects another language must register that language too.
 *
 * `markdown` declares an injections query that reaches for `markdown_inline`
 * by name, but `markdown_inline` was never registered as a filetype. The
 * lookup therefore failed at runtime — the worker logs "No parser found for
 * injection language" and continues — so the entire inline layer was silently
 * missing in the product: `**bold**` kept its markers and its weight, inline
 * backticks stayed visible, and only block-level colouring appeared
 * (2026-09-18). Nothing failed, nothing was red; the feature was just absent.
 *
 * The wasm had been embedded in the binary the whole time. Embedding an asset
 * and registering a filetype are different things, and only the second one
 * makes a grammar reachable.
 */

const registered = new Set(PARSER_CONFIG.parsers.map((parser) => parser.filetype))

/** Languages an injections query names, as `(#set! injection.language "x")`. */
const INJECTED_BY_QUERY: Record<string, string[]> = {
  markdown: ["markdown_inline"],
}

describe("parsers-config", () => {
  test("every language named by an injections query is itself registered", () => {
    for (const [host, injected] of Object.entries(INJECTED_BY_QUERY)) {
      expect(registered).toContain(host)
      for (const language of injected) {
        expect(registered).toContain(language)
      }
    }
  })

  test("markdown_inline is registered, so emphasis and inline code can be parsed", () => {
    // Named on its own because it is the one the product actually lost.
    expect(registered).toContain("markdown_inline")
  })

  test("markdown_inline carries a highlights query", () => {
    // A registered grammar with no highlights parses the text and colours
    // nothing, which looks identical to not being registered at all.
    const entry = PARSER_CONFIG.parsers.find((parser) => parser.filetype === "markdown_inline")
    expect(entry).toBeDefined()
    expect(entry!.queries?.highlights?.length ?? 0).toBeGreaterThan(0)
  })

  test("markdown maps its inline node types to markdown_inline", () => {
    // Registering the grammar is necessary but NOT sufficient. The worker
    // resolves a node type's language only through `injectionMapping.nodeTypes`
    // — it never reads the `(#set! injection.language ...)` the query declares.
    // Without the mapping the injection is skipped silently, with no warning
    // logged anywhere, so the inline layer is absent while everything else
    // looks healthy. `addDefaultParsers` replaces an entry by filetype instead
    // of merging, so overriding markdown here drops OpenTUI's own mapping.
    const markdown = PARSER_CONFIG.parsers.find((parser) => parser.filetype === "markdown")
    expect(markdown).toBeDefined()
    const nodeTypes = (markdown as { injectionMapping?: { nodeTypes?: Record<string, string> } }).injectionMapping
      ?.nodeTypes
    expect(nodeTypes).toBeDefined()
    expect(nodeTypes!["inline"]).toBe("markdown_inline")
    expect(nodeTypes!["pipe_table_cell"]).toBe("markdown_inline")
  })

  test("every injection target named by a mapping is a registered filetype", () => {
    // The general form: a mapping that points at an unregistered language fails
    // exactly as silently as a missing mapping.
    for (const parser of PARSER_CONFIG.parsers) {
      const nodeTypes = (parser as { injectionMapping?: { nodeTypes?: Record<string, string> } }).injectionMapping
        ?.nodeTypes
      for (const target of Object.values(nodeTypes ?? {})) {
        expect(registered).toContain(target)
      }
    }
  })

  test("filetypes are unique", () => {
    const filetypes = PARSER_CONFIG.parsers.map((parser) => parser.filetype)
    expect(new Set(filetypes).size).toBe(filetypes.length)
  })
})
