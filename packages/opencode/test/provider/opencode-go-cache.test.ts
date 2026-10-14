import { describe, expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { ProviderTransform } from "@/provider/transform"

/**
 * Supersedes blanket retention/breakpoint assumptions with provider receipts:
 * experiments/2026-10-14_prompt-cache-options-2026-10-14T15-33-29-937Z/summary.json.
 * Go Flash rejected retention and ttl=24h, accepted implicit/30m.
 * Go GLM-5.3 accepted implicit/24h; retention duration remains unmeasured.
 */
const baseModel = {
  name: "Test Model",
  capabilities: {
    temperature: true, reasoning: true, attachment: false, toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 1000000, output: 131072 },
  status: "active", options: {}, headers: {}, release_date: "2026-08-26",
} as any

const goModel = (id: string) => ({
  ...baseModel, id: `opencode-go/${id}`, providerID: "opencode-go",
  api: { id, url: "https://opencode.ai/inference/go/v1", npm: "@ai-sdk/openai-compatible" },
})
const zenModel = (id: string, npm = "@ai-sdk/openai-compatible") => ({
  ...baseModel, id: `opencode/${id}`, providerID: "opencode",
  api: { id, url: "https://opencode.ai/inference/v1", npm },
})

function capture(bodies: Record<string, any>[]) {
  return (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({
      id: "local-probe", object: "chat.completion", created: 0,
      model: bodies.at(-1)?.model,
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  }) as typeof fetch
}

describe("Go defaults follow the measured model contract", () => {
  test.each([["glm-5.3-flash", "30m"], ["glm-5.3", "24h"]])(
    "%s gets accepted implicit cache options ttl=%s through the installed SDK",
    async (id, ttl) => {
      const model = goModel(id)
      const defaults = ProviderTransform.options({ model, sessionID: "ses_test" })
      expect(defaults.prompt_cache_key).toBe(`ses_test:${model.id}`)
      expect(defaults.prompt_cache_options).toEqual({ mode: "implicit", ttl })
      expect(defaults.prompt_cache_retention).toBeUndefined()
      const bodies: Record<string, any>[] = []
      const sdk = createOpenAICompatible({
        name: model.providerID, apiKey: "local-probe", baseURL: model.api.url, fetch: capture(bodies),
      })
      await generateText({
        model: sdk(id), prompt: "Cache contract probe",
        providerOptions: ProviderTransform.providerOptions(model, defaults),
      })
      expect(bodies).toHaveLength(1)
      expect(bodies[0]?.model).toBe(id)
      expect(bodies[0]?.prompt_cache_options).toEqual({ mode: "implicit", ttl })
      expect(bodies[0]?.prompt_cache_key).toBe(`ses_test:${model.id}`)
      expect(bodies[0]?.prompt_cache_retention).toBeUndefined()
    },
  )

  test.each(["deepseek-v4-flash", "mimo-v2.6-flash"])("%s has no unmeasured TTL default", (id) => {
    const result = ProviderTransform.options({ model: goModel(id), sessionID: "ses_test" })
    expect(result.prompt_cache_retention).toBeUndefined()
    expect(result.prompt_cache_options).toBeUndefined()
  })

  test("explicit supported cache options survive merge and packaging", () => {
    const model = goModel("glm-5.3-flash")
    const explicit = { prompt_cache_options: { mode: "explicit", ttl: "30m" }, prompt_cache_breakpoint: 0 }
    const result = ProviderTransform.providerOptions(model, {
      ...ProviderTransform.options({ model, sessionID: "ses_test", providerOptions: explicit }),
      ...explicit,
    })
    expect(result["opencode-go"].prompt_cache_options).toEqual(explicit.prompt_cache_options)
    expect(result["opencode-go"].prompt_cache_breakpoint).toBe(0)
    expect(result["opencode-go"].prompt_cache_retention).toBeUndefined()
  })
})

describe("cache dialect belongs to the actual SDK", () => {
  test("actual Zen Muse OpenAI SDK has no compatible-only or invented TTL default", () => {
    const result = ProviderTransform.options({
      model: zenModel("muse-spark-1.3-contributor-free", "@ai-sdk/openai"), sessionID: "ses_test",
    })
    expect(result.prompt_cache_key).toBeUndefined()
    expect(result.prompt_cache_retention).toBeUndefined()
    expect(result.prompt_cache_options).toBeUndefined()
  })

  test("Zen native OpenAI preserves camelCase explicit cache controls on the wire", async () => {
    const model = zenModel("muse-spark-1.3-contributor-free", "@ai-sdk/openai")
    const explicit = { setCacheKey: true, promptCacheRetention: "24h" }
    const defaults = ProviderTransform.options({ model, sessionID: "ses_native", providerOptions: explicit })
    expect(defaults.promptCacheKey).toBe(`ses_native:${model.id}`)
    expect(defaults.prompt_cache_key).toBeUndefined()
    expect(defaults.prompt_cache_retention).toBeUndefined()
    const bodies: Record<string, any>[] = []
    const sdk = createOpenAI({ apiKey: "local-probe", baseURL: model.api.url, fetch: capture(bodies) })
    await generateText({
      model: sdk.chat(model.api.id), prompt: "Native SDK cache controls",
      providerOptions: ProviderTransform.providerOptions(model, { ...defaults, ...explicit }),
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.prompt_cache_key).toBe(`ses_native:${model.id}`)
    expect(bodies[0]?.prompt_cache_retention).toBe("24h")
    expect(bodies[0]?.prompt_cache_options).toBeUndefined()
  })

  test.each([
    goModel("deepseek-v4-flash"), goModel("mimo-v2.6-flash"), goModel("glm-5.3-flash"),
    zenModel("muse-spark-1.3-contributor-free", "@ai-sdk/openai"),
    {
      ...baseModel, id: "novita-ai/zai-org/glm-5.3-flash", providerID: "novita-ai",
      api: { id: "zai-org/glm-5.3-flash", url: "https://api.novita.ai/openai", npm: "@ai-sdk/openai-compatible" },
    },
  ])("$id receives no implicit Anthropic-style message breakpoints", (model) => {
    const result = ProviderTransform.message([
      { role: "system", content: "stable" }, { role: "user", content: "hi" },
    ], model, {})
    expect(JSON.stringify(result)).not.toContain("cache_control")
    expect(JSON.stringify(result)).not.toContain("cacheControl")
  })

  test("the real Anthropic SDK retains its explicit message cache markers", () => {
    const model = {
      ...baseModel, id: "anthropic/claude-sonnet-4-5", providerID: "anthropic",
      api: { id: "claude-sonnet-4-5", npm: "@ai-sdk/anthropic", url: "https://api.anthropic.com/v1" },
    }
    const result = ProviderTransform.message([
      { role: "system", content: "stable" }, { role: "user", content: "hi" },
    ], model, {})
    expect(result[0]?.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral" })
  })
})
