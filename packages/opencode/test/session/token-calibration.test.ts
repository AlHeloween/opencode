import { describe, expect, test, beforeEach } from "bun:test"
import { TokenCalibration } from "../../src/session/token-calibration"

// Helper to create a minimal Provider.Model
function makeModel(providerID: string, modelID: string, contextLimit = 128000) {
  return {
    id: modelID,
    providerID,
    name: modelID,
    limit: { context: contextLimit, output: 4096 },
    attachment: false,
    reasoning: false,
    tool_call: false,
    temperature: true,
  } as any
}

describe("TokenCalibration", () => {
  // Note: TokenCalibration uses module-level Map, so tests share state.
  // Each test uses a unique model ID to avoid interference.

  test("getFactor returns 1.0 for unknown model", () => {
    const model = makeModel("test", "unknown-model-" + Math.random())
    expect(TokenCalibration.getFactor(model)).toBe(1.0)
  })

  test("getObservedLimit returns undefined for unknown model", () => {
    const model = makeModel("test", "unknown-model-" + Math.random())
    expect(TokenCalibration.getObservedLimit(model)).toBeUndefined()
  })

  test("update stores observed context limit", () => {
    const model = makeModel("test", "limit-test-" + Math.random())
    TokenCalibration.update(model, { contextLimit: 64000 })
    expect(TokenCalibration.getObservedLimit(model)).toBe(64000)
  })

  test("update computes factor from inputTokens / ourEstimate", () => {
    const model = makeModel("test", "factor-test-" + Math.random())
    // Provider says 15000 tokens, we estimated 10000 -> factor = 1.5
    TokenCalibration.update(model, { inputTokens: 15000 }, 10000)
    expect(TokenCalibration.getFactor(model)).toBe(1.5)
  })

  test("update smooths factor on subsequent observations", () => {
    const model = makeModel("test", "smooth-test-" + Math.random())
    // First observation: factor = 1.5
    TokenCalibration.update(model, { inputTokens: 15000 }, 10000)
    expect(TokenCalibration.getFactor(model)).toBe(1.5)

    // Second observation: factor = 2.0
    // Smoothed: 1.5 * 0.7 + 2.0 * 0.3 = 1.05 + 0.6 = 1.65
    TokenCalibration.update(model, { inputTokens: 20000 }, 10000)
    expect(TokenCalibration.getFactor(model)).toBeCloseTo(1.65, 2)
  })

  test("update without ourEstimate does not change factor", () => {
    const model = makeModel("test", "noest-test-" + Math.random())
    TokenCalibration.update(model, { contextLimit: 64000 })
    expect(TokenCalibration.getFactor(model)).toBe(1.0)
  })

  test("update with zero ourEstimate does not change factor", () => {
    const model = makeModel("test", "zero-test-" + Math.random())
    TokenCalibration.update(model, { inputTokens: 15000 }, 0)
    expect(TokenCalibration.getFactor(model)).toBe(1.0)
  })

  test("different models have independent calibrations", () => {
    const modelA = makeModel("p1", "independent-a-" + Math.random())
    const modelB = makeModel("p2", "independent-b-" + Math.random())

    TokenCalibration.update(modelA, { inputTokens: 15000 }, 10000)
    TokenCalibration.update(modelB, { inputTokens: 8000 }, 10000)

    expect(TokenCalibration.getFactor(modelA)).toBe(1.5)
    expect(TokenCalibration.getFactor(modelB)).toBe(0.8)
  })
})
