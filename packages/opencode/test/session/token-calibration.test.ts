import { describe, expect, test } from "bun:test"
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
  //
  // The factor tests that used to live here are gone with `getFactor` (2026-09-19): the
  // factor had zero readers and the code that APPLIED it was deleted in `e86abaab42`. What
  // remains is the one field with a consumer — the observed context limit, which `usable()`
  // and `hasSpareOutput` prefer over the declared `model.limit`.

  test("getObservedLimit returns undefined for unknown model", () => {
    const model = makeModel("test", "unknown-model-" + Math.random())
    expect(TokenCalibration.getObservedLimit(model)).toBeUndefined()
  })

  test("update stores observed context limit", () => {
    const model = makeModel("test", "limit-test-" + Math.random())
    TokenCalibration.update(model, { contextLimit: 64000 })
    expect(TokenCalibration.getObservedLimit(model)).toBe(64000)
  })

  test("update with no contextLimit records nothing", () => {
    const model = makeModel("test", "empty-update-" + Math.random())
    TokenCalibration.update(model, {})
    expect(TokenCalibration.getObservedLimit(model)).toBeUndefined()
  })
})
