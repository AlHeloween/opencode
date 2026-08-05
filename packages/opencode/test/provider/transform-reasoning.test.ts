import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"

/**
 * Critical tests for DeepSeek V4 reasoning_content roundtrip.
 *
 * Bug #2 (reasoning_content passback): if reasoning_content is not preserved
 * across turns, DeepSeek V4 returns HTTP 400 — "The reasoning_content in the
 * thinking mode must be passed back to the API."
 *
 * These tests verify that opencode's message() transformer correctly:
 *   1. Preserves reasoning_content on DeepSeek models
 *   2. Adds empty reasoning parts when missing (all-or-nothing invariant)
 *   3. Extracts reasoning into providerOptions.openaiCompatible.reasoning_content
 *      for models with interleaved capability
 */

// ── Helpers ───────────────────────────────────────────────────────────────

function mkDeepseekModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: "deepseek-v3.2-thinking",
    providerID: "deepseek",
    name: "DeepSeek V3.2 Thinking",
    family: "deepseek",
    api: {
      id: "deepseek-v3.2-thinking",
      npm: "@ai-sdk/openai-compatible",
      url: "https://api.deepseek.com/v1",
    },
    capabilities: {
      input: { image: false },
      output: { image: false },
      reasoning: true,
      toolCall: true,
      interleaved: false,
      temperature: true,
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 163840, output: 65536 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-06-15",
  } as any
}

function mkInterleavedModel(field: "reasoning_content" | "reasoning_details"): Provider.Model {
  return {
    ...mkDeepseekModel(),
    id: "test-interleaved-model",
    api: { ...mkDeepseekModel().api, id: "test-interleaved-model", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      ...mkDeepseekModel().capabilities,
      interleaved: { field },
    },
  } as any
}

function assistantMsg(parts: Array<{ type: string; text: string }>) {
  return { role: "assistant" as const, content: parts }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("DeepSeek V4 reasoning_content roundtrip", () => {
  test("preserves reasoning part in content for DeepSeek models", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "I should search first." }, { type: "text", text: "Let me look." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0]!.text).toBe("I should search first.")
  })

  test("adds empty reasoning part when missing — all-or-nothing invariant", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "text", text: "Here is the answer." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0]!.text).toBe("") // empty reasoning added
  })

  test("adds empty reasoning part for assistant with string content (non-array)", () => {
    const model = mkDeepseekModel()
    const msgs = [
      { role: "assistant" as const, content: "Plain text content" },
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0]!.text).toBe("")
  })

  test("does not add reasoning to non-DeepSeek models", () => {
    const model = { ...mkDeepseekModel(), api: { ...mkDeepseekModel().api, id: "gpt-5.2" } }
    const msgs = [
      assistantMsg([{ type: "text", text: "Answer." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model as any)
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(0)
  })

  test("does not add duplicate reasoning part", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "thinking" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1) // not duplicated
  })

  test("preserves reasoning across multiple assistant messages", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "Step 1 thinking." }, { type: "text", text: "Step 1 output." }]),
      assistantMsg([{ type: "text", text: "Step 2 output — no reasoning from API." }]),
      assistantMsg([{ type: "reasoning", text: "Step 3 thinking." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    // All three messages should have a reasoning part
    expect((result[0]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(true)
    expect((result[1]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(true) // added
    expect((result[2]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(true)
  })

  test("leaves user messages untouched", () => {
    const model = mkDeepseekModel()
    const msgs = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] },
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    // User messages should not get reasoning parts
    expect((result[0]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(false)
  })
})

describe("Interleaved capability — reasoning extraction", () => {
  test("extracts reasoning into providerOptions for reasoning_content field", () => {
    const model = mkInterleavedModel("reasoning_content")
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "deep thinking" }, { type: "text", text: "answer" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    // Reasoning should be moved to providerOptions
    expect((result[0]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(false)
    const po = (result[0]! as any).providerOptions?.openaiCompatible
    expect(po).toBeDefined()
    expect(po.reasoning_content).toBe("deep thinking")
  })

  test("extracts reasoning into providerOptions for reasoning_details field", () => {
    const model = mkInterleavedModel("reasoning_details")
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "detailed analysis" }, { type: "text", text: "result" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const po = (result[0]! as any).providerOptions?.openaiCompatible
    expect(po).toBeDefined()
    expect(po.reasoning_details).toBe("detailed analysis")
  })

  test("always sets the field even when empty — DeepSeek requires this", () => {
    const model = mkInterleavedModel("reasoning_content")
    const msgs = [
      assistantMsg([{ type: "text", text: "No reasoning from model." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const po = (result[0]! as any).providerOptions?.openaiCompatible
    expect(po).toBeDefined()
    expect(po.reasoning_content).toBe("") // empty but present
  })

  test("does not extract reasoning for excluded providers (OpenRouter/Anthropic/Vertex)", () => {
    const model = {
      ...mkInterleavedModel("reasoning_content"),
      api: { ...mkInterleavedModel("reasoning_content").api, npm: "@openrouter/ai-sdk-provider" },
    }
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "thinking" }, { type: "text", text: "output" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model as any)
    // OpenRouter is excluded — reasoning stays in content
    expect((result[0]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(true)
  })
})
