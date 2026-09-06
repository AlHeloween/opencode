import { describe, expect, test } from "bun:test"
import { mapOpenRouterModel } from "../../src/provider/provider-sync"

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
