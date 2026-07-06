import { describe, expect, test } from "bun:test"
import { embeddedWasmAssetPath, embeddedTreeSitterGrammarAssetPaths, readEmbeddedWasmAsset } from "../../src/util/wasm-embedded"

describe("wasm-embedded", () => {
  describe("embeddedWasmAssetPath", () => {
    test("returns a path for chafa.wasm", () => {
      const path = embeddedWasmAssetPath("chafa.wasm")
      expect(path).toBeString()
      expect(path!.length).toBeGreaterThan(0)
    })

    test("returns a path for tree-sitter.wasm", () => {
      const path = embeddedWasmAssetPath("tree-sitter.wasm")
      expect(path).toBeString()
      expect(path!.length).toBeGreaterThan(0)
    })

    test("returns a path for tokenizer.wasm", () => {
      const path = embeddedWasmAssetPath("tokenizer.wasm")
      expect(path).toBeString()
      expect(path!.length).toBeGreaterThan(0)
    })

    test("returns a path for grammar assets", () => {
      const path = embeddedWasmAssetPath("grammars/tree-sitter-python.wasm")
      expect(path).toBeString()
      expect(path!.length).toBeGreaterThan(0)
    })

    test("returns undefined for unknown assets", () => {
      expect(embeddedWasmAssetPath("nonexistent.wasm")).toBeUndefined()
      expect(embeddedWasmAssetPath("")).toBeUndefined()
    })
  })

  describe("embeddedTreeSitterGrammarAssetPaths", () => {
    test("includes expected grammar entries", () => {
      expect(embeddedTreeSitterGrammarAssetPaths).toBeArray()
      expect(embeddedTreeSitterGrammarAssetPaths.length).toBeGreaterThanOrEqual(24)

      // Spot-check specific grammars
      expect(embeddedTreeSitterGrammarAssetPaths).toContain("grammars/tree-sitter-python.wasm")
      expect(embeddedTreeSitterGrammarAssetPaths).toContain("grammars/tree-sitter-bash.wasm")
      expect(embeddedTreeSitterGrammarAssetPaths).toContain("grammars/tree-sitter-rust.wasm")
    })
  })

  describe("readEmbeddedWasmAsset", () => {
    test("returns bytes for chafa.wasm", async () => {
      const result = await readEmbeddedWasmAsset("chafa.wasm")
      expect(result.bytes).not.toBeNull()
      expect(result.path).not.toBeNull()
      expect((result.bytes as ArrayBuffer).byteLength).toBeGreaterThan(0)
    })

    test("returns bytes for tree-sitter.wasm", async () => {
      const result = await readEmbeddedWasmAsset("tree-sitter.wasm")
      expect(result.bytes).not.toBeNull()
      expect((result.bytes as ArrayBuffer).byteLength).toBeGreaterThan(0)
    })

    test("returns null bytes for unknown assets", async () => {
      const result = await readEmbeddedWasmAsset("nonexistent.wasm")
      expect(result.bytes).toBeNull()
      expect(result.path).toBeNull()
      expect(result.tried).toBeArray()
      expect(result.tried.length).toBe(0)
    })
  })
})
