import { describe, expect, test } from "bun:test"
import { generateText } from "ai"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { mergeDeep } from "remeda"
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
  test("drops reasoning text for assistant messages WITHOUT tool calls (API ignores it)", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "I should search first." }, { type: "text", text: "Let me look." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0]!.text).toBe("") // CoT dropped, empty part kept for wire shape
  })

  test("preserves reasoning for assistant messages WITH tool calls (400 guard)", () => {
    const model = mkDeepseekModel()
    const msgs = [
      {
        role: "assistant" as const,
        content: [
          { type: "reasoning", text: "I should call the tool." },
          { type: "tool-call", toolCallId: "call-1", toolName: "read", input: {} },
        ],
      },
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0]!.text).toBe("I should call the tool.")
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
    const result = ProviderTransform.message(msgs as any, model as any, {})
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
    expect(reasoningParts.length).toBe(1) // not duplicated; text dropped (no tool call)
    expect(reasoningParts[0]!.text).toBe("")
  })

  test("preserves reasoning across multiple assistant messages", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "Step 1 thinking." }, { type: "text", text: "Step 1 output." }]),
      assistantMsg([{ type: "text", text: "Step 2 output — no reasoning from API." }]),
      assistantMsg([{ type: "reasoning", text: "Step 3 thinking." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    // All three messages should have a reasoning part (empty — no tool calls)
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
    const result = ProviderTransform.message(msgs as any, model as any, {})
    // OpenRouter is excluded — reasoning stays in content
    expect((result[0]!.content as any[]).some((p: any) => p.type === "reasoning")).toBe(true)
  })

  test("keeps reasoning content for the dedicated DeepSeek provider", () => {
    const model = {
      ...mkInterleavedModel("reasoning_content"),
      api: { ...mkInterleavedModel("reasoning_content").api, id: "deepseek-v4-pro", npm: "@ai-sdk/deepseek" },
    }
    const result = ProviderTransform.message(
      [assistantMsg([{ type: "reasoning", text: "deep thinking" }, { type: "text", text: "answer" }])] as any,
      model as any,
      {},
    )
    expect((result[0]!.content as any[]).some((part: any) => part.type === "reasoning")).toBe(true)
    expect((result[0]! as any).providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("prompt_cache_key routing (P3)", () => {
  const base = {
    model: { ...mkDeepseekModel(), api: { ...mkDeepseekModel().api, npm: "@ai-sdk/deepseek" } },
    sessionID: "ses-test",
  }

  test("deepseek SDK route does NOT set prompt_cache_key (dead field — never serialized, no isolation)", () => {
    const out = ProviderTransform.options(base as any)
    expect(out.prompt_cache_key).toBeUndefined()
  })

  test("openai-compatible route DOES set prompt_cache_key (bucket isolation verified on KAT)", () => {
    const out = ProviderTransform.options({
      model: { ...mkDeepseekModel(), providerID: "pasha-coder", api: { ...mkDeepseekModel().api, id: "kat-coder", npm: "@ai-sdk/openai-compatible" } },
      sessionID: "ses-test",
    } as any)
    expect(out.prompt_cache_key).toBe("ses-test:deepseek-v3.2-thinking")
  })
})

describe("Dedicated DeepSeek V4 thinking", () => {
  const model = {
    ...mkDeepseekModel(),
    id: "deepseek/deepseek-v4-pro",
    api: { ...mkDeepseekModel().api, id: "deepseek-v4-pro", npm: "@ai-sdk/deepseek" },
  } as any

  test("exposes off, adaptive, high, and max variants for TUI selection", () => {
    expect(ProviderTransform.variants(model)).toEqual({
      off: { thinking: { type: "disabled" } },
      adaptive: { thinking: { type: "adaptive" } },
      high: { thinking: { type: "enabled" }, reasoningEffort: "high" },
      max: { thinking: { type: "enabled" }, reasoningEffort: "max" },
    })
  })

  test("serializes every TUI variant through the dedicated provider", async () => {
    const bodies: Record<string, any>[] = []
    const deepseek = createDeepSeek({
      apiKey: "test",
      fetch: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return Response.json({
          id: "test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      }) as typeof fetch,
    })
    for (const variant of Object.values(ProviderTransform.variants(model))) {
      await generateText({
        model: deepseek("deepseek-v4-pro"),
        prompt: "ping",
        providerOptions: ProviderTransform.providerOptions(
          model,
          mergeDeep(ProviderTransform.options({ model, sessionID: "test-session" }), variant),
        ),
      })
    }
    expect(bodies.map((body) => ({ thinking: body.thinking, reasoningEffort: body.reasoning_effort }))).toEqual([
      { thinking: { type: "disabled" }, reasoningEffort: undefined },
      { thinking: { type: "adaptive" }, reasoningEffort: undefined },
      { thinking: { type: "enabled" }, reasoningEffort: "high" },
      { thinking: { type: "enabled" }, reasoningEffort: "max" },
    ])
  })
})
