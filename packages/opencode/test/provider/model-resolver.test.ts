import { describe, expect, test } from "bun:test"
import { resolveModel } from "@/provider/model-resolver"

describe("model-resolver", () => {
  describe("priority providers", () => {
    test("resolves deepseek/deepseek-chat via priority path", async () => {
      const start = Date.now()
      const result = await resolveModel("deepseek", "deepseek-chat")
      const elapsed = Date.now() - start

      expect(result).not.toBeUndefined()
      expect(result?.providerID).toBe("deepseek")
      expect(result?.modelID).toBe("deepseek-chat")
      expect(result?.source).toBe("cache")
      expect(elapsed).toBeLessThan(100) // generous bound; priority path should be fast
    })

    test("resolves opencode/ring-2.6-1t-free via priority path", async () => {
      const result = await resolveModel("opencode", "ring-2.6-1t-free")

      expect(result).not.toBeUndefined()
      expect(result?.providerID).toBe("opencode")
      expect(result?.modelID).toBe("ring-2.6-1t-free")
      expect(result?.source).toBe("cache")
    })
  })

  describe("general providers", () => {
    test("resolves anthropic/claude-sonnet-4-20250514 via lazy-load", async () => {
      const result = await resolveModel("anthropic", "claude-sonnet-4-20250514")

      expect(result).not.toBeUndefined()
      expect(result?.providerID).toBe("anthropic")
      expect(result?.modelID).toBe("claude-sonnet-4-20250514")
      expect(result?.source).toBe("cache")
    })

    test("resolves openai/gpt-4 via lazy-load", async () => {
      const result = await resolveModel("openai", "gpt-4")

      expect(result).not.toBeUndefined()
      expect(result?.providerID).toBe("openai")
      expect(result?.modelID).toBe("gpt-4")
    })

    test("resolves google/gemini-2.5-pro via lazy-load", async () => {
      const result = await resolveModel("google", "gemini-2.5-pro")

      expect(result).not.toBeUndefined()
      expect(result?.providerID).toBe("google")
      expect(result?.modelID).toBe("gemini-2.5-pro")
    })
  })

  describe("unknown provider", () => {
    test("returns undefined for unknown provider", async () => {
      const result = await resolveModel("unknown-provider-xyz", "some-model")

      expect(result).toBeUndefined()
    })
  })

  describe("model capabilities", () => {
    test("deepseek-chat has expected capabilities", async () => {
      const result = await resolveModel("deepseek", "deepseek-chat")

      expect(result).not.toBeUndefined()
      expect(result?.parameters.capabilities).not.toBeUndefined()
      expect(result?.parameters.capabilities?.temperature).toBe(true)
      expect(result?.parameters.capabilities?.toolcall).toBe(true)
    })

    test("opencode/ring-2.6-1t-free has expected capabilities", async () => {
      const result = await resolveModel("opencode", "ring-2.6-1t-free")

      expect(result).not.toBeUndefined()
      expect(result?.parameters.capabilities).not.toBeUndefined()
      expect(result?.parameters.capabilities?.temperature).toBe(true)
    })
  })
})
