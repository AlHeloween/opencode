import { describe, expect, test } from "bun:test"
import { pickFreeVisionModel, type SeedProvider } from "../../src/provider/free-default"

const zen = (models: SeedProvider["models"]): SeedProvider => ({ id: "opencode", models })

const free = (context: number, image = true, toolcall = true) => ({
  cost: { input: 0, output: 0 },
  limit: { context },
  capabilities: { input: { image }, toolcall },
})

describe("pickFreeVisionModel — the global seed chooser", () => {
  test("free + vision + largest context wins; paid and vision-less models are ignored", () => {
    const pick = pickFreeVisionModel([
      zen({
        "small-free-vision": free(200_000),
        "big-free-vision": free(1_000_000),
        "paid-bigger": { cost: { input: 3, output: 12 }, limit: { context: 2_000_000 }, capabilities: { input: { image: true }, toolcall: true } },
        "free-unpriced": { limit: { context: 4_000_000 }, capabilities: { input: { image: true }, toolcall: true } },
        "free-no-vision": { cost: { input: 0, output: 0 }, limit: { context: 3_000_000 }, capabilities: { input: { image: false }, toolcall: true } },
        "free-embedding": free(5_000_000, true, false),
      }),
    ])
    expect(pick).toEqual({ providerID: "opencode", modelID: "big-free-vision" })
  })

  test("big-pickle never wins while another free vision model qualifies (fail protection only)", () => {
    const pick = pickFreeVisionModel([
      zen({
        "big-pickle": free(400_000),
        "another-free-vision": free(128_000),
      }),
    ])
    expect(pick).toEqual({ providerID: "opencode", modelID: "another-free-vision" })
  })

  test("big-pickle IS the pick when nothing else qualifies — the fail-protection case", () => {
    const pick = pickFreeVisionModel([
      zen({
        "big-pickle": free(400_000),
        "free-no-vision": { cost: { input: 0, output: 0 }, limit: { context: 1_000_000 }, capabilities: { input: { image: false }, toolcall: true } },
      }),
    ])
    expect(pick).toEqual({ providerID: "opencode", modelID: "big-pickle" })
  })

  test("another provider is never consulted, and an empty zen yields nothing", () => {
    expect(
      pickFreeVisionModel([
        { id: "deepseek", models: { "deepseek-v4-pro": free(128_000) } },
      ]),
    ).toBeUndefined()
    expect(pickFreeVisionModel([zen({})])).toBeUndefined()
  })
})
