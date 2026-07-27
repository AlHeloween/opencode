import { describe, expect, test } from "bun:test"
import {
  embeddedWasmAssetPath,
  embeddedWasmAssetPaths,
  embeddedTreeSitterGrammarAssetPaths,
  readEmbeddedWasmAsset,
} from "../../src/util/wasm-embedded"

describe("wasm-embedded", () => {
  test("declares a unique path for every embedded asset", () => {
    expect(embeddedWasmAssetPaths.length).toBeGreaterThanOrEqual(66)
    expect(new Set(embeddedWasmAssetPaths).size).toBe(embeddedWasmAssetPaths.length)
    for (const key of embeddedWasmAssetPaths) {
      expect(embeddedWasmAssetPath(key)).toBeString()
    }
  })

  test("uses the current Tree-sitter runtime key", () => {
    expect(embeddedWasmAssetPath("web-tree-sitter.wasm")).toBeString()
    expect(embeddedWasmAssetPath("tree-sitter.wasm")).toBeUndefined()
  })

  test("includes Mermaid and expected grammar entries", () => {
    expect(embeddedWasmAssetPaths).toContain("mermaid/mermaid_wasm_renderer_bg.wasm")
    expect(embeddedTreeSitterGrammarAssetPaths).toContain("grammars/tree-sitter-python.wasm")
    expect(embeddedTreeSitterGrammarAssetPaths).toContain("grammars/tree-sitter-bash.wasm")
    expect(embeddedTreeSitterGrammarAssetPaths).toContain("grammars/tree-sitter-rust.wasm")
  })

  test("reads every declared embedded asset", async () => {
    for (const key of embeddedWasmAssetPaths) {
      const result = await readEmbeddedWasmAsset(key)
      expect(result.path).not.toBeNull()
      expect(result.bytes).not.toBeNull()
      expect((result.bytes as ArrayBuffer).byteLength).toBeGreaterThan(0)
    }
  })

  test("returns undefined for unknown assets", async () => {
    expect(embeddedWasmAssetPath("nonexistent.wasm")).toBeUndefined()
    const result = await readEmbeddedWasmAsset("nonexistent.wasm")
    expect(result.bytes).toBeNull()
    expect(result.path).toBeNull()
    expect(result.tried).toEqual([])
  })
})
