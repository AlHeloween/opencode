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

  test("filetypes are unique", () => {
    const filetypes = PARSER_CONFIG.parsers.map((parser) => parser.filetype)
    expect(new Set(filetypes).size).toBe(filetypes.length)
  })
})
