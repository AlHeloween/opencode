import { describe, expect, test } from "bun:test"
import {
  applyBundledOverrides,
  mapHuggingFaceModel,
  mapOpenRouterModel,
  mergeHuggingFaceModels,
} from "../../src/provider/provider-sync"
import type { ModelsDevModel } from "../../src/provider/provider-sync"

/**
 * OpenRouter live-model ingestion pricing contract (RCA 2026-09-06): the
 * OpenRouter /models API returns pricing PER TOKEN as decimal strings, while
 * the opencode cost convention (models.dev + Session.getUsage, which divides
 * by 1e6) is PER MILLION tokens. The mapper must convert, otherwise every
 * OpenRouter request computes ~$0.00 cost while the real balance drains.
 */

const base = {
  id: "z-ai/glm-5.3-flash",
  name: "GLM 5.3 Flash",
  context_length: 200_000,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools"],
}

describe("mapOpenRouterModel: pricing per-token → per-million", () => {
  test("converts prompt/completion/cache_read by 1e6", () => {
    const model = mapOpenRouterModel({
      ...base,
      pricing: { prompt: "0.000000075", completion: "0.00000025", input_cache_read: "0.000000015" },
    })
    expect(model).toBeDefined()
    // Cross-validated against the models.dev zhipuai direct entry for the same
    // model: input 0.075 / output 0.25 / cache_read 0.015 per million.
    expect(model!.cost!.input).toBeCloseTo(0.075, 10)
    expect(model!.cost!.output).toBeCloseTo(0.25, 10)
    expect(model!.cost!.cache_read).toBeCloseTo(0.015, 10)
  })

  test("free models (0) stay 0", () => {
    const model = mapOpenRouterModel({ ...base, pricing: { prompt: "0", completion: "0" } })
    expect(model!.cost!.input).toBe(0)
    expect(model!.cost!.output).toBe(0)
    expect(model!.cost!.cache_read).toBeUndefined()
  })

  test("dynamically priced (-1) clamps to 0, never negative", () => {
    const model = mapOpenRouterModel({ ...base, pricing: { prompt: "-1", completion: "-1" } })
    expect(model!.cost!.input).toBe(0)
    expect(model!.cost!.output).toBe(0)
  })

  test("malformed pricing strings become 0, not NaN", () => {
    const model = mapOpenRouterModel({ ...base, pricing: { prompt: "abc", completion: "" } })
    expect(model!.cost!.input).toBe(0)
    expect(model!.cost!.output).toBe(0)
  })

  test("missing pricing omits the cost table", () => {
    const model = mapOpenRouterModel(base)
    expect(model).toBeDefined()
    expect(model!.cost).toBeUndefined()
  })
})

test("registers StreamLake Vanchin without inventing an account endpoint", async () => {
  const registry = await applyBundledOverrides({}, {})
  expect(registry["streamlake-vanchin"]).toEqual({
    id: "streamlake-vanchin",
    name: "StreamLake Vanchin",
    env: ["STREAMLAKE_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints",
    doc: "https://vanchin.streamlake.ai/",
    models: {},
  })
})

// ---------- Hugging Face router mapping + merge ----------

type HfRaw = Parameters<typeof mapHuggingFaceModel>[0]
type HfProvider = NonNullable<HfRaw["providers"]>[number]

const hfProvider = (over: Partial<HfProvider> = {}): HfProvider => ({ provider: "p", status: "live", ...over })
const hfRaw = (over: Partial<HfRaw> = {}): HfRaw => ({
  id: "zai-org/GLM-5.3-Flash",
  created: 1787640194,
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  providers: [],
  ...over,
})

describe("mapHuggingFaceModel: fastest-route collapse", () => {
  test("pricing and context come from the routed (highest-throughput) provider", () => {
    const model = mapHuggingFaceModel(
      hfRaw({
        providers: [
          hfProvider({ provider: "slow", throughput: 10, context_length: 1000, pricing: { input: 0.5, output: 2 } }),
          hfProvider({
            provider: "fast",
            throughput: 90,
            context_length: 1048576,
            pricing: { input: 0.15, output: 0.5 },
          }),
        ],
      }),
    )
    expect(model).toBeDefined()
    expect(model!.cost!.input).toBe(0.15)
    expect(model!.cost!.output).toBe(0.5)
    expect(model!.limit.context).toBe(1048576)
  })

  test("falls back to the fastest provider reporting a price when the routed one is unpriced", () => {
    const model = mapHuggingFaceModel(
      hfRaw({
        providers: [
          hfProvider({ provider: "fast", throughput: 90 }),
          hfProvider({ provider: "priced", throughput: 10, pricing: { input: 0.2, output: 0.8 } }),
        ],
      }),
    )
    expect(model!.cost).toEqual({ input: 0.2, output: 0.8 })
  })

  test("free routes stay zero; unpriced routes omit the cost table", () => {
    const free = mapHuggingFaceModel(
      hfRaw({ providers: [hfProvider({ throughput: 5, pricing: { input: 0, output: 0 } })] }),
    )
    expect(free!.cost).toEqual({ input: 0, output: 0 })

    const unpriced = mapHuggingFaceModel(
      hfRaw({ id: "zai-org/GLM-5.3-Flash-BF16", providers: [hfProvider({ provider: "zai-org", throughput: 59 })] }),
    )
    expect(unpriced!.cost).toBeUndefined()
    expect(unpriced!.limit).toEqual({ context: 0, output: 0 })
  })

  test("rounds prices to 6 decimals", () => {
    const model = mapHuggingFaceModel(
      hfRaw({ providers: [hfProvider({ pricing: { input: 0.8899999999999999, output: 1 } })] }),
    )
    expect(model!.cost!.input).toBe(0.89)
  })

  test("context falls back to the largest reported context", () => {
    const model = mapHuggingFaceModel(
      hfRaw({
        providers: [
          hfProvider({ provider: "fast", throughput: 90 }),
          hfProvider({ provider: "a", throughput: 10, context_length: 32768 }),
          hfProvider({ provider: "b", throughput: 5, context_length: 200000 }),
        ],
      }),
    )
    expect(model!.limit.context).toBe(200000)
  })

  test("tools/structured_output union live providers; non-live entries are ignored", () => {
    const model = mapHuggingFaceModel(
      hfRaw({
        providers: [
          hfProvider({ provider: "dead", status: "error", pricing: { input: 1, output: 1 }, supports_tools: true }),
          hfProvider({ provider: "tools", supports_tools: true }),
          hfProvider({ provider: "structured", supports_structured_output: true }),
        ],
      }),
    )
    expect(model!.cost).toBeUndefined()
    expect(model!.tool_call).toBe(true)
    expect(model!.structured_output).toBe(true)
  })

  test("skips models without a live provider or without an id", () => {
    expect(mapHuggingFaceModel(hfRaw({ providers: [hfProvider({ status: "error" })] }))).toBeUndefined()
    expect(mapHuggingFaceModel({ providers: [hfProvider()] })).toBeUndefined()
  })

  test("derives name, modalities and dates from the router entry", () => {
    const model = mapHuggingFaceModel(hfRaw({ providers: [hfProvider()] }))
    expect(model!.name).toBe("GLM-5.3-Flash")
    expect(model!.attachment).toBe(true)
    expect(model!.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
    expect(model!.release_date).toBe("2026-08-25")
    expect(model!.last_updated).toBe("2026-08-25")
    expect(model!.model_type).toBe("chat")
  })
})

describe("mergeHuggingFaceModels: curated registry + live router", () => {
  const curated: ModelsDevModel = {
    id: "zai-org/GLM-5.3-Flash",
    name: "GLM-5.3-Flash",
    description: "Efficient GLM model for fast reasoning, coding, and agent workflows",
    family: "glm",
    attachment: true,
    reasoning: true,
    reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
    tool_call: true,
    structured_output: true,
    temperature: true,
    release_date: "2026-08-26",
    last_updated: "2026-08-26",
    modalities: { input: ["text", "image"], output: ["text"] },
    open_weights: true,
    limit: { context: 1048576, output: 131072 },
    cost: { input: 0.15, output: 0.5, cache_read: 0.01 },
  }

  test("curated capability fields survive; live pricing and context win", () => {
    const live = mapHuggingFaceModel(
      hfRaw({
        providers: [hfProvider({ throughput: 90, context_length: 1048576, pricing: { input: 0.2, output: 0.6 } })],
      }),
    )!
    const merged = mergeHuggingFaceModels({ [curated.id]: curated }, { [live.id]: live })
    const model = merged[curated.id]!
    expect(model.reasoning).toBe(true)
    expect(model.reasoning_options).toEqual([{ type: "effort", values: ["low", "high", "max"] }])
    expect(model.description).toBe(curated.description)
    expect(model.name).toBe("GLM-5.3-Flash")
    expect(model.limit.output).toBe(131072)
    expect(model.limit.context).toBe(1048576)
    expect(model.cost).toEqual({ input: 0.2, output: 0.6, cache_read: 0.01 })
  })

  test("retains upstream-only ids the router no longer lists", () => {
    const extra: ModelsDevModel = { ...curated, id: "moonshotai/Kimi-K2-Thinking", name: "Kimi-K2-Thinking" }
    const merged = mergeHuggingFaceModels({ [extra.id]: extra }, {})
    expect(merged[extra.id]).toEqual(extra)
  })

  test("adds new ids with conservative defaults", () => {
    const live = mapHuggingFaceModel(
      hfRaw({
        id: "CohereLabs/aya-expanse-32b",
        created: 1789006678,
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        providers: [hfProvider({ provider: "cohere", throughput: 5 })],
      }),
    )!
    const merged = mergeHuggingFaceModels({}, { [live.id]: live })
    const model = merged[live.id]!
    expect(model.reasoning).toBe(false)
    expect(model.cost).toBeUndefined()
    expect(model.limit).toEqual({ context: 0, output: 0 })
  })

  test("quantisation variants inherit their base model's capability metadata", () => {
    const bf16 = mapHuggingFaceModel(
      hfRaw({
        id: "zai-org/GLM-5.3-Flash-BF16",
        created: 1787640305,
        providers: [hfProvider({ provider: "zai-org", throughput: 59, supports_tools: true })],
      }),
    )!
    const merged = mergeHuggingFaceModels({ [curated.id]: curated }, { [bf16.id]: bf16 })
    const model = merged[bf16.id]!
    expect(model.name).toBe("GLM-5.3-Flash-BF16")
    expect(model.reasoning).toBe(true)
    expect(model.reasoning_options).toEqual([{ type: "effort", values: ["low", "high", "max"] }])
    expect(model.limit).toEqual({ context: 1048576, output: 131072 })
    expect(model.description).toBe(curated.description)
    expect(model.cost).toBeUndefined()
  })

  test("variant inheritance resolves a live-only base regardless of placement order", () => {
    const base = mapHuggingFaceModel(
      hfRaw({
        id: "zai-org/GLM-4.6V",
        providers: [hfProvider({ provider: "a", throughput: 5, context_length: 200000 })],
      }),
    )!
    const variant = mapHuggingFaceModel(
      hfRaw({ id: "zai-org/GLM-4.6V-FP8", providers: [hfProvider({ provider: "a", throughput: 5 })] }),
    )!
    const merged = mergeHuggingFaceModels({}, { [variant.id]: variant, [base.id]: base })
    expect(merged[variant.id]!.limit.context).toBe(200000)
  })
})
