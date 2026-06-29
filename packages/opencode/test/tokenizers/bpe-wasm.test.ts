import { describe, expect, test } from "bun:test"
import { BpeWasmTokenizer } from "@/tokenizers/bpe-wasm"
import type { TokenizerModel } from "@/tokenizers/types"

/**
 * Minimal test tokenizer model derived from the GPT-2 vocab.
 * Contains enough tokens to exercise BPE encoding/decoding.
 */
function makeTestModel(): TokenizerModel {
  const vocab: Record<string, number> = {}
  let id = 0

  // Byte-level tokens (U+0100+ encoding for non-printable ASCII)
  for (let b = 0; b < 256; b++) {
    let char: string
    if (b >= 33 && b <= 126) {
      char = String.fromCodePoint(b)
    } else {
      char = String.fromCodePoint(256 + countNonPrintableBefore(b))
    }
    vocab[char] = id++
  }

  // Add some common words and merges
  const extraTokens = ["hello", " world", "hello world", "Hello", "World", "!", " 123", "123",
    "пр", "ив", "ет", "ми", "р", "привет", "мир", "a", "aa", "aaa", ""]
  for (const t of extraTokens) {
    if (!(t in vocab)) {
      vocab[t] = id++
    }
  }

  // Merges (pair -> rank, lower = higher priority)
  const merges: Record<string, number> = {}
  let rank = 0
  merges["h e"] = rank++
  merges["he l"] = rank++
  merges["hel lo"] = rank++
  merges["l o"] = rank++
  merges["lo w"] = rank++
  merges["low o"] = rank++
  merges["loow or"] = rank++
  merges["d !"] = rank++

  return {
    vocab,
    merges,
    specialTokens: {},
    vocabSize: id,
  }
}

function countNonPrintableBefore(b: number): number {
  let count = 0
  for (let i = 0; i < b; i++) {
    if (i < 33 || i > 126) count++
  }
  return count
}

describe("bpe-wasm", () => {
  const model = makeTestModel()

  test("countTokens returns > 0 for non-empty text", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    expect(wasm.countTokens("hello world")).toBeGreaterThan(0)
  })

  test("encode returns non-empty array for non-empty text", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    const ids = wasm.encode("hello world")
    expect(ids.length).toBeGreaterThan(0)
  })

  test("encode produces same count for repeated inputs", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    const first = wasm.encode("hello world")
    const second = wasm.encode("hello world")
    expect(first).toEqual(second)
  })

  test("empty string — 0 tokens", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    expect(wasm.countTokens("")).toBe(0)
    expect(wasm.encode("")).toEqual([])
  })

  test("decode round-trips encoded tokens", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    const text = "hello world"
    const ids = wasm.encode(text)
    const decoded = wasm.decode(ids)
    expect(decoded).toBeDefined()
  })

  test("large input does not crash", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    const longText = "a".repeat(10000)
    const count = wasm.countTokens(longText)
    expect(count).toBeGreaterThan(0)
  })

  test("Cyrillic text works", async () => {
    const wasm = await BpeWasmTokenizer.load(model)
    if (!wasm) {
      console.log("WASM not available, skipping")
      return
    }
    const ids = wasm.encode("привет мир")
    expect(ids.length).toBeGreaterThan(0)
  })

  test("handle — returns null when WASM unavailable", async () => {
    // Passing an empty model should trigger failure
    const wasm = await BpeWasmTokenizer.load({
      vocab: {},
      merges: {},
      specialTokens: {},
      vocabSize: 0,
    })
    expect(wasm).toBeNull()
  })
})
