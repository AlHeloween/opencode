import { describe, expect, test } from "bun:test"
import { extractTokenLimits } from "../../src/provider/error"

describe("provider.error.extractTokenLimits", () => {
  test("extracts context limit from OpenRouter/DeepSeek pattern", () => {
    const r = extractTokenLimits("This model's maximum context length is 128000 tokens")
    expect(r.contextLimit).toBe(128000)
    expect(r.inputTokens).toBeUndefined()
  })

  test("extracts context limit from vLLM pattern", () => {
    const r = extractTokenLimits("context length is only 32768 tokens")
    expect(r.contextLimit).toBe(32768)
  })

  test("extracts context limit from GitHub Copilot pattern", () => {
    const r = extractTokenLimits("request exceeds the limit of 128000")
    expect(r.contextLimit).toBe(128000)
  })

  test("extracts context limit from xAI Grok pattern", () => {
    const r = extractTokenLimits("maximum prompt length is 100000")
    expect(r.contextLimit).toBe(100000)
  })

  test("extracts context limit from Mistral pattern", () => {
    const r = extractTokenLimits("too large for model with 32768 maximum context length")
    expect(r.contextLimit).toBe(32768)
  })

  test("handles comma-separated numbers", () => {
    const r = extractTokenLimits("maximum context length is 1,000,000 tokens")
    expect(r.contextLimit).toBe(1000000)
  })

  test("extracts input token count", () => {
    const r = extractTokenLimits("input token count 150000 exceeds the maximum")
    expect(r.inputTokens).toBe(150000)
  })

  test("extracts both limit and input count", () => {
    const r = extractTokenLimits("input token count 150000 exceeds the maximum. maximum context length is 128000 tokens")
    expect(r.contextLimit).toBe(128000)
    expect(r.inputTokens).toBe(150000)
  })

  test("returns undefined for unrecognized messages", () => {
    const r = extractTokenLimits("something went wrong")
    expect(r.contextLimit).toBeUndefined()
    expect(r.inputTokens).toBeUndefined()
  })

  test("is case insensitive", () => {
    const r = extractTokenLimits("MAXIMUM CONTEXT LENGTH IS 64000 TOKENS")
    expect(r.contextLimit).toBe(64000)
  })
})
