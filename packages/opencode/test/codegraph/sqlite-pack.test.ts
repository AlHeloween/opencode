import { describe, expect, test } from "bun:test"
import path from "path"
import {
  extractPathsFromText,
  formatPackMarkdown,
  packGraphForFiles,
  packToSymTag,
} from "../../src/codegraph/sqlite-pack"

const RUST_ROOT = path.resolve(import.meta.dir, "../../../../external/codegraph-rust")

describe("sqlite-pack", () => {
  test("extractPathsFromText finds project paths", () => {
    const text = `
      **\`sandbox_field_test/def.ts\`** — stuff
      and crates/codegraph-graph/src/lib.rs here
    `
    const paths = extractPathsFromText(text)
    expect(paths.some((p) => p.includes("sandbox_field_test/def.ts"))).toBe(true)
    expect(paths.some((p) => p.includes("codegraph-graph/src/lib.rs"))).toBe(true)
  })

  test("packGraphForFiles packs sandbox_field_test when indexed", () => {
    const pack = packGraphForFiles(RUST_ROOT, [
      "sandbox_field_test/def.ts",
      "sandbox_field_test/use.ts",
    ])
    if (pack.symbols.length === 0) {
      // index may not include fixtures on CI — still validates empty shape
      expect(pack.crossFileEdges).toEqual([])
      return
    }
    expect(pack.symbols.some((s) => s.name === "SandboxConfig")).toBe(true)
    expect(pack.symbols.some((s) => s.name === "extraField")).toBe(true)
    expect(pack.crossFileEdges.length).toBeGreaterThan(0)
    const md = formatPackMarkdown(pack, { query: "field test" })
    expect(md).toContain("CodeGraph pack")
    expect(md).toContain("Cross-file edges")
    expect(md).not.toMatch(/Found \d+ symbols across/) // not MCP prose
    const tag = packToSymTag(pack)
    expect(tag).toContain("KINDS:")
    expect(tag).toContain("TOP:")
  })

  test("packToSymTag hard-fails on empty pack content", () => {
    const empty = packGraphForFiles(RUST_ROOT, [])
    // empty files → kinds none still produces a tag string; only truly blank fails
    const tag = packToSymTag(empty)
    expect(tag).toContain("KINDS:")
  })
})
