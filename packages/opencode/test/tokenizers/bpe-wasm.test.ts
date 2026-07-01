import { describe, expect, test } from "bun:test"
import { initTokenizer } from "@/tokenizers/bpe-wasm"
import { loadDeepSeekV4 } from "@/tokenizers/deepseek-v4/loader"
import { loadQwen3 } from "@/tokenizers/qwen3/loader"

describe("bpe-wasm", () => {
  test("loads tokenizer wasm module", async () => {
    expect(await initTokenizer()).toBeTrue()
  })

  test("loads DeepSeek V4 bundled tokenizer model", async () => {
    const tokenizer = await loadDeepSeekV4()
    expect(tokenizer).toBeDefined()
    const ids = tokenizer!.encode("hello world")
    expect(tokenizer!.countTokens("hello world")).toBeGreaterThan(0)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => Number.isInteger(id))).toBeTrue()
    expect(tokenizer!.decode(ids.slice(0, 5)).length).toBeGreaterThan(0)
  })

  test("loads Qwen3 bundled tokenizer model", async () => {
    const tokenizer = await loadQwen3()
    expect(tokenizer).toBeDefined()
    const ids = tokenizer!.encode("hello world")
    expect(tokenizer!.countTokens("hello world")).toBeGreaterThan(0)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => Number.isInteger(id))).toBeTrue()
    expect(tokenizer!.decode(ids.slice(0, 5)).length).toBeGreaterThan(0)
  })
})
