import { describe, expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"
import { ProviderTransform } from "@/provider/transform"

// Claude Haiku 5.5 compatibility (2026-10-11).
//
// Primary contract: platform.claude.com/docs/en/models/haiku-5-5/migration-guide
// ("Configure thinking": `thinking.type = "enabled"` returns 400; use adaptive
// thinking + `output_config.effort`) and
// platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5
// (`effort`: low | medium | high | xhigh | max, default medium).
//
// The fix is one shared predicate — `anthropicAdaptiveEfforts` — consumed by every
// SDK path that already emits adaptive variants (direct Anthropic, Vertex, gateway,
// Bedrock, SAP). These cases pin that all paths classify Haiku 5.5 as adaptive and
// that legacy Haiku 4.5 keeps its `enabled`/`budgetTokens` payload.

const FIVE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

const createMockModel = (overrides: Partial<any> = {}): any => ({
  id: "test/test-model",
  providerID: "test",
  api: {
    id: "test-model",
    url: "https://api.test.com",
    npm: "@ai-sdk/anthropic",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0.001,
    output: 0.002,
    cache: { read: 0.0001, write: 0.0002 },
  },
  limit: {
    context: 200_000,
    output: 64_000,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-10-07",
  ...overrides,
})

describe("Anthropic Haiku 5.5 adaptive thinking", () => {
  test("direct Anthropic (hyphen spelling): five effort levels, adaptive thinking", () => {
    const model = createMockModel({
      id: "anthropic/claude-haiku-5-5",
      providerID: "anthropic",
      api: { id: "claude-haiku-5-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(FIVE_EFFORTS)
    expect(result.high).toEqual({ thinking: { type: "adaptive" }, effort: "high" })
    expect(result.low.effort).toBe("low")
    expect(result.medium.effort).toBe("medium")
    expect(result.xhigh.effort).toBe("xhigh")
    expect(result.max.effort).toBe("max")
    // The rejected payload must be gone from every variant.
    expect(JSON.stringify(result)).not.toContain("budgetTokens")
    expect(JSON.stringify(result)).not.toContain("enabled")
  })

  test("direct Anthropic (dot spelling): same five-level adaptive set", () => {
    const model = createMockModel({
      id: "anthropic/claude-haiku-5.5",
      providerID: "anthropic",
      api: { id: "claude-haiku-5.5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(FIVE_EFFORTS)
    expect(result.high).toEqual({ thinking: { type: "adaptive" }, effort: "high" })
    // No `display` on Haiku — that belongs to Opus 4.7 only.
    expect(result.high.thinking).not.toHaveProperty("display")
  })

  test("vertex Anthropic: five-level adaptive set", () => {
    const model = createMockModel({
      id: "google-vertex/claude-haiku-5-5",
      providerID: "google-vertex",
      api: {
        id: "claude-haiku-5-5",
        url: "https://us-central1-aiplatform.googleapis.com",
        npm: "@ai-sdk/google-vertex/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(FIVE_EFFORTS)
    expect(result.max).toEqual({ thinking: { type: "adaptive" }, effort: "max" })
    expect(JSON.stringify(result)).not.toContain("budgetTokens")
  })

  test("gateway: five-level adaptive set", () => {
    const model = createMockModel({
      id: "anthropic/claude-haiku-5-5",
      providerID: "gateway",
      api: { id: "claude-haiku-5-5", url: "https://gateway.ai.cloudflare.com", npm: "@ai-sdk/gateway" },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(FIVE_EFFORTS)
    expect(result.xhigh).toEqual({ thinking: { type: "adaptive" }, effort: "xhigh" })
    expect(JSON.stringify(result)).not.toContain("budgetTokens")
  })

  test("bedrock: adaptive reasoningConfig with maxReasoningEffort", () => {
    const model = createMockModel({
      id: "bedrock/anthropic-claude-haiku-5-5",
      providerID: "bedrock",
      api: {
        id: "anthropic.claude-haiku-5-5",
        url: "https://bedrock.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(FIVE_EFFORTS)
    expect(result.low).toEqual({ reasoningConfig: { type: "adaptive", maxReasoningEffort: "low" } })
    expect(result.max).toEqual({ reasoningConfig: { type: "adaptive", maxReasoningEffort: "max" } })
    expect(JSON.stringify(result)).not.toContain("budgetTokens")
  })

  test("SAP AI provider: five-level adaptive set", () => {
    const model = createMockModel({
      id: "sap/anthropic--claude-haiku-5-5",
      providerID: "sap-ai",
      api: {
        id: "anthropic--claude-haiku-5-5",
        url: "https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com",
        npm: "@jerome-benoit/sap-ai-provider-v2",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(FIVE_EFFORTS)
    expect(result.high).toEqual({ thinking: { type: "adaptive" }, effort: "high" })
    expect(JSON.stringify(result)).not.toContain("budgetTokens")
  })
})

describe("Anthropic legacy Haiku 4.5 is unchanged", () => {
  test("hyphen spelling keeps enabled/budgetTokens", () => {
    const model = createMockModel({
      id: "anthropic/claude-haiku-4-5",
      providerID: "anthropic",
      api: { id: "claude-haiku-4-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["high", "max"])
    expect(result.high).toEqual({ thinking: { type: "enabled", budgetTokens: 100_000 } })
    expect(result.max).toEqual({ thinking: { type: "enabled", budgetTokens: 200_000 } })
  })

  test("dot spelling keeps enabled/budgetTokens", () => {
    const model = createMockModel({
      id: "anthropic/claude-haiku-4.5",
      providerID: "anthropic",
      api: { id: "claude-haiku-4.5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["high", "max"])
    expect(result.high.thinking.type).toBe("enabled")
    expect(JSON.stringify(result)).not.toContain("adaptive")
  })

  test("a model without reasoning capability returns no variants", () => {
    const model = createMockModel({
      id: "anthropic/claude-haiku-5-5",
      providerID: "anthropic",
      api: { id: "claude-haiku-5-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
      capabilities: { reasoning: false },
    })
    expect(ProviderTransform.variants(model)).toEqual({})
  })
})

describe("Anthropic Haiku 5.5 SDK wire", () => {
  test("the variant serializes to adaptive thinking + output_config.effort on the real SDK", async () => {
    let body: Record<string, any> | undefined
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: "fixture" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
    const anthropic = createAnthropic({ apiKey: "local-fixture-only", fetch: fetchImpl })
    const model = createMockModel({
      id: "anthropic/claude-haiku-5-5",
      providerID: "anthropic",
      api: { id: "claude-haiku-5-5", url: "https://fixture.invalid", npm: "@ai-sdk/anthropic" },
    })
    const variant = ProviderTransform.variants(model).high

    await generateText({
      model: anthropic("claude-haiku-5-5"),
      prompt: "fixture",
      maxOutputTokens: 16_000,
      maxRetries: 0,
      providerOptions: { anthropic: variant },
    })

    expect(body).toBeDefined()
    expect(body?.model).toBe("claude-haiku-5-5")
    expect(body?.thinking?.type).toBe("adaptive")
    expect(body?.thinking?.budget_tokens).toBeUndefined()
    expect(body?.output_config?.effort).toBe("high")
  })
})
