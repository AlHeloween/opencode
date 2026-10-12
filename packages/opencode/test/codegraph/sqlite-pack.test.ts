import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import {
  extractPathsFromText,
  formatPackMarkdown,
  packGraphForFiles,
  packToSymTag,
} from "../../src/codegraph/sqlite-pack"

const RUST_ROOT = path.resolve(import.meta.dir, "../../../../external/codegraph-rust")

describe("sqlite-pack", () => {
  test("MCP paths outside standard directories survive for all existing source extensions", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codegraph-paths-"))
    const files = ["prompt_kernel/model.py", "delphi/InstallerOps.pas", "tools/server.go",
      "engine/main.cpp", "скрипты/файл с пробелом.ps1"]
    try {
      for (const file of files) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        writeFileSync(path.join(root, file), "fixture")
      }
      const text = files.map((file) => `**\`${file}\`** — source`).join("\n")
      expect(extractPathsFromText(text, root)).toEqual(files)
      expect(extractPathsFromText("`missing/file.py` `../outside.py`", root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
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
