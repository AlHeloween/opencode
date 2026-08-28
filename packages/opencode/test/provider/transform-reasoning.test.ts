import { describe, expect, test } from "bun:test"
import { generateText } from "ai"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
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
  test("keeps reasoning text for assistant messages WITHOUT tool calls (unified: never strip)", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "I should search first." }, { type: "text", text: "Let me look." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    const reasoningParts = content.filter((p: any) => p.type === "reasoning")
    expect(reasoningParts.length).toBe(1)
    expect(reasoningParts[0]!.text).toBe("I should search first.") // full continuity: CoT rides along (probe: tokens/cache identical)
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
    expect(reasoningParts.length).toBe(1) // not duplicated; text preserved (unified: never strip)
    expect(reasoningParts[0]!.text).toBe("thinking")
  })

  test("preserves reasoning across multiple assistant messages", () => {
    const model = mkDeepseekModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "Step 1 thinking." }, { type: "text", text: "Step 1 output." }]),
      assistantMsg([{ type: "text", text: "Step 2 output — no reasoning from API." }]),
      assistantMsg([{ type: "reasoning", text: "Step 3 thinking." }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    // All three messages keep a reasoning part (first two carry real CoT — never
    // stripped; the second had none, so an empty part was added)
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

describe("vanchin StreamLake KAT reasoning_content replay (verified live)", () => {
  function mkKatModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
    return {
      ...mkDeepseekModel(),
      id: "ep-kneqk9-1786632248553436783",
      providerID: "pasha-coder",
      name: "KAT Coder Pro",
      api: {
        id: "ep-kneqk9-1786632248553436783",
        npm: "@ai-sdk/github-copilot",
        url: "https://vanchin.streamlake.ai/api/gateway/coding/v1",
      },
      ...overrides,
    } as any
  }

  test("serializes cache identity and preserve_thinking into the Pasha wire body", async () => {
    const bodies: Record<string, any>[] = []
    const model = mkKatModel({
      api: {
        id: "ep-kneqk9-1786632248553436783",
        npm: "@ai-sdk/openai-compatible",
        url: "https://vanchin.streamlake.ai/api/gateway/coding/v1",
      },
    })
    const pasha = createOpenAICompatible({
      name: "pasha-coder",
      apiKey: "test",
      baseURL: model.api.url,
      fetch: (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return Response.json({
          id: "test",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      }) as typeof fetch,
    })

    await generateText({
      model: pasha(model.api.id),
      prompt: "continue after a tool replay",
      providerOptions: ProviderTransform.providerOptions(
        model,
        ProviderTransform.options({ model, sessionID: "ses-pasha-smoke" }),
      ),
    })

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      prompt_cache_key: "ses-pasha-smoke:ep-kneqk9-1786632248553436783",
      chat_template_kwargs: { preserve_thinking: true },
    })
    expect(bodies[0].cache_control).toBeUndefined()
  })

  test("drops reasoning parts from assistant replay (no tool calls)", () => {
    const model = mkKatModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "CoT bytes" }, { type: "text", text: "Answer" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    expect(content.filter((p: any) => p.type === "reasoning")).toHaveLength(0)
    expect(content.filter((p: any) => p.type === "text")).toHaveLength(1)
  })

  test("drop only affects the wire — stored parts keep reasoning for the UI (save/render invariant)", () => {
    const model = mkKatModel()
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "CoT bytes" }, { type: "text", text: "Answer" }]),
    ]
    ProviderTransform.message(msgs as any, model, {})
    // The drop builds new wire objects; the input array (what the session
    // stores and the TUI renders) keeps its reasoning parts. Cache-control
    // providerOptions may be attached in place by applyCaching — content is
    // what must survive.
    const inputContent = msgs[0]!.content as any[]
    expect(inputContent.filter((p: any) => p.type === "reasoning")).toHaveLength(1)
    expect(inputContent.find((p: any) => p.type === "reasoning")?.text).toBe("CoT bytes")
    expect(inputContent.filter((p: any) => p.type === "text")).toHaveLength(1)
  })

  test("drops reasoning but keeps tool calls (live: no-echo accepted, no 400)", () => {
    const model = mkKatModel()
    const msgs = [
      {
        role: "assistant" as const,
        content: [
          { type: "reasoning", text: "CoT bytes" },
          { type: "tool-call", toolCallId: "call-1", toolName: "read", input: {} },
        ],
      },
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    expect(content.filter((p: any) => p.type === "reasoning")).toHaveLength(0)
    expect(content.filter((p: any) => p.type === "tool-call")).toHaveLength(1)
  })

  test("strips reasoning_content from providerOptions.openaiCompatible (interleaved-style echo)", () => {
    const model = mkKatModel()
    const msgs = [
      {
        role: "assistant" as const,
        content: [{ type: "text", text: "Answer" }],
        providerOptions: { openaiCompatible: { reasoning_content: "CoT bytes" } },
      },
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    expect((result[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })

  test("does NOT touch GitHub Copilot opaque reasoning (non-streamlake url)", () => {
    const model = mkKatModel({
      api: {
        id: "gpt-5-codex",
        npm: "@ai-sdk/github-copilot",
        url: "https://api.githubcopilot.com",
      },
    })
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "opaque CoT" }, { type: "text", text: "Answer" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    expect(content.filter((p: any) => p.type === "reasoning")).toHaveLength(1)
  })

  test("drops reasoning for other openai-compatible proxies too (LiteLLM-style)", () => {
    const model = mkKatModel({
      api: {
        id: "litellm-proxy-model",
        npm: "@ai-sdk/openai-compatible",
        url: "https://litellm.example.com/v1",
      },
    })
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "CoT" }, { type: "text", text: "Answer" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    expect(content.filter((p: any) => p.type === "reasoning")).toHaveLength(0)
  })

  test("zen Qwen: drops reasoning (vendor docs: do not add reasoning_content)", () => {
    const model = mkKatModel({
      id: "qwen3.6-plus-free",
      api: {
        id: "qwen3.6-plus-free",
        npm: "@ai-sdk/openai-compatible",
        url: "https://opencode.ai/zen/v1",
      },
    } as any)
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "CoT bytes" }, { type: "text", text: "Answer" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    const content = result[0]!.content as any[]
    expect(content.filter((p: any) => p.type === "reasoning")).toHaveLength(0)
  })

  test("zen MIMO tool-call message keeps the echo via interleaved field (400-guard)", () => {
    const model = mkKatModel({
      id: "mimo-v2.5-free",
      api: {
        id: "mimo-v2.5-free",
        npm: "@ai-sdk/openai-compatible",
        url: "https://opencode.ai/zen/v1",
      },
      capabilities: {
        ...mkKatModel().capabilities,
        interleaved: { field: "reasoning_content" },
      },
    } as any)
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
    expect((result[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBe("I should call the tool.")
  })

  test("zen MIMO plain message keeps CoT via interleaved field (unified: never strip)", () => {
    const model = mkKatModel({
      id: "mimo-v2.5-free",
      api: {
        id: "mimo-v2.5-free",
        npm: "@ai-sdk/openai-compatible",
        url: "https://opencode.ai/zen/v1",
      },
      capabilities: {
        ...mkKatModel().capabilities,
        interleaved: { field: "reasoning_content" },
      },
    } as any)
    const msgs = [
      assistantMsg([{ type: "reasoning", text: "CoT bytes" }, { type: "text", text: "Answer" }]),
    ]
    const result = ProviderTransform.message(msgs as any, model, {})
    expect((result[0] as any).providerOptions?.openaiCompatible?.reasoning_content).toBe("CoT bytes")
  })
})

describe("Dedicated DeepSeek V4 thinking", () => {
  const model = {
    ...mkDeepseekModel(),
    id: "deepseek/deepseek-v4-pro",
    api: { ...mkDeepseekModel().api, id: "deepseek-v4-pro", npm: "@ai-sdk/deepseek" },
  } as any

  test("exposes off, low, high, and max variants for TUI selection", () => {
    expect(ProviderTransform.variants(model)).toEqual({
      off: { thinking: { type: "disabled" } },
      low: { thinking: { type: "enabled" }, reasoningEffort: "low" },
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
      { thinking: { type: "enabled" }, reasoningEffort: "low" },
      { thinking: { type: "enabled" }, reasoningEffort: "high" },
      { thinking: { type: "enabled" }, reasoningEffort: "max" },
    ])
  })
})
