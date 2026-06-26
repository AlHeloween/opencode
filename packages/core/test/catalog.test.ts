import { describe, test, expect } from "bun:test"
import { resolveTokenizer, BUILTIN_TOKENIZERS } from "../src/catalog"
import { BUILTIN_PROVIDERS } from "../src/catalog-providers"

describe("BUILTIN_PROVIDERS", () => {
  test("contains Anthropic provider", () => {
    const anthropic = BUILTIN_PROVIDERS.find((p) => p.id === "anthropic")
    expect(anthropic).toBeTruthy()
    expect(anthropic!.label).toBe("Anthropic")
    expect(anthropic!.models.length).toBeGreaterThanOrEqual(1)
  })

  test("contains OpenAI provider", () => {
    expect(BUILTIN_PROVIDERS.some((p) => p.id === "openai")).toBe(true)
  })

  test("contains Google provider", () => {
    expect(BUILTIN_PROVIDERS.some((p) => p.id === "google")).toBe(true)
  })

  test("Anthropic has Claude Sonnet 4 model", () => {
    const anthropic = BUILTIN_PROVIDERS.find((p) => p.id === "anthropic")!
    const model = anthropic.models.find((m) => m.id === "claude-sonnet-4-20250514")
    expect(model).toBeTruthy()
    expect(model!.contextWindow).toBe(200000)
  })
})

describe("BUILTIN_TOKENIZERS", () => {
  test("has gpt-5 entry", () => {
    expect(BUILTIN_TOKENIZERS["gpt-5"].path).toBe("o200k_base")
  })

  test("has deepseek wildcard entry", () => {
    expect(BUILTIN_TOKENIZERS["*deepseek-v4*"].path).toBe("deepseek-v4")
  })
})

describe("resolveTokenizer", () => {
  test("exact match returns config", () => {
    const result = resolveTokenizer("gpt-5")
    expect(result?.path).toBe("o200k_base")
  })

  test("wildcard match returns config", () => {
    const result = resolveTokenizer("gpt-4o-mini")
    expect(result?.path).toBe("o200k_base")
  })

  test("case-insensitive wildcard match", () => {
    const result = resolveTokenizer("Qwen3-Coder-Plus")
    expect(result?.path).toBe("qwen3")
  })

  test("unknown model returns undefined", () => {
    expect(resolveTokenizer("nonexistent-model")).toBeUndefined()
  })
})
