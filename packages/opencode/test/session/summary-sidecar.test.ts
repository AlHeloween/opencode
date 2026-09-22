import { describe, expect, test } from "bun:test"
import { SIDECAR_COOLDOWN_MS, isCoolingDown } from "../../src/session/sidecar-policy"

describe("summary sidecar policy", () => {
  // The budget-rule and attempt-count pins are gone with the generation they described (owner,
  // 2026-09-22): there is no request to budget and no attempt to count. What remains is the cooldown
  // of the CHECKPOINT cadence, which still runs — it gates publishing the model-ready checkpoint
  // before a fold, not asking a model for a summary.
  test("cools down failed and successful cycles at the same boundary", () => {
    const end = 1_000_000
    expect(isCoolingDown(undefined, end)).toBe(false)
    expect(isCoolingDown(end, end + SIDECAR_COOLDOWN_MS - 1)).toBe(true)
    expect(isCoolingDown(end, end + SIDECAR_COOLDOWN_MS)).toBe(false)
  })
})
