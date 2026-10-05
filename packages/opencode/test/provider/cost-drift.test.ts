import { describe, expect, test } from "bun:test"
import { observeCostDrift, resetCostDrift } from "../../src/provider/balance"

/** Fold one well-behaved sample: the bill matches the model exactly. */
const exact = (n: number) => Array.from({ length: n }, () => observeCostDrift("p", 0.01, 0.01))

describe("cost model drift", () => {
  test("stays silent while the window is still filling", () => {
    resetCostDrift()
    for (let i = 0; i < 7; i++) expect(observeCostDrift("p", 0.01, 0.01)).toBeUndefined()
  })

  test("stays silent while the bill matches the model", () => {
    resetCostDrift()
    exact(20)
    expect(observeCostDrift("p", 0.01, 0.01)).toBeUndefined()
  })

  test("reports a provider billing twice the computed cost", () => {
    resetCostDrift()
    for (let i = 0; i < 8; i++) observeCostDrift("p", 0.01, 0.02)
    const report = observeCostDrift("p", 0.01, 0.02)
    expect(report).toBeDefined()
    expect(report?.ratio).toBeCloseTo(2, 5)
    // The reporting call is the 9th sample, so the window holds the last 8.
    expect(report?.predicted).toBeCloseTo(0.08, 6)
    expect(report?.actual).toBeCloseTo(0.16, 6)
  })

  test("reports an UNDER-billed provider too — drift is not only expensive drift", () => {
    resetCostDrift()
    for (let i = 0; i < 8; i++) observeCostDrift("p", 0.01, 0.004)
    const report = observeCostDrift("p", 0.01, 0.004)
    expect(report?.ratio).toBeCloseTo(0.4, 5)
  })

  test("ignores a top-up, which is not spend", () => {
    resetCostDrift()
    // A $20 top-up reads as a NEGATIVE delta. Folding it would swamp the
    // window and permanently hide a real 2x drift.
    for (let i = 0; i < 8; i++) {
      expect(observeCostDrift("p", 0.01, -20)).toBeUndefined()
    }
  })

  test("a settled rate silences an old outlier once it slides out", () => {
    resetCostDrift()
    for (let i = 0; i < 8; i++) observeCostDrift("p", 0.01, 0.02)
    expect(observeCostDrift("p", 0.01, 0.02)).toBeDefined()
    // The provider repriced. Eight matching samples later the window is clean
    // and the alarm stops — a stale outlier must not keep it firing forever.
    for (let i = 0; i < 8; i++) observeCostDrift("p", 0.01, 0.01)
    expect(observeCostDrift("p", 0.01, 0.01)).toBeUndefined()
  })

  test("windows are per provider — one noisy provider cannot mask another", () => {
    resetCostDrift()
    for (let i = 0; i < 8; i++) observeCostDrift("noisy", 0.01, 0.05)
    for (let i = 0; i < 8; i++) expect(observeCostDrift("quiet", 0.01, 0.01)).toBeUndefined()
    expect(observeCostDrift("noisy", 0.01, 0.05)?.ratio).toBeCloseTo(5, 5)
  })

  test("small drift inside tolerance does not raise an alarm", () => {
    resetCostDrift()
    // 10% off is inside the 15% tolerance: a tariff that moved a little is not
    // an incident, and an alarm that cries wolf gets ignored.
    for (let i = 0; i < 8; i++) observeCostDrift("p", 0.01, 0.011)
    expect(observeCostDrift("p", 0.01, 0.011)).toBeUndefined()
  })
})