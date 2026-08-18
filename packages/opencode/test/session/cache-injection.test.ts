import { describe, expect, test } from "bun:test"
import {
  accumulateStepTokens,
  CACHE_INJECTION_WARN_TOKENS,
  injectionDelta,
  prefixResetDelta,
  type StepTokens,
} from "../../src/session/processor"

describe("cache injection guard (T3)", () => {
  test("no previous total → no warning (cold start)", () => {
    expect(injectionDelta(undefined, 100_000, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
  })

  test("delta above threshold → returns delta", () => {
    expect(injectionDelta(102_528, 178_175, CACHE_INJECTION_WARN_TOKENS)).toBe(75_647)
    // observed worst case: 109K → 178K injection
    expect(injectionDelta(109_042, 178_175, CACHE_INJECTION_WARN_TOKENS)).toBe(69_133)
  })

  test("delta at/below threshold → no warning", () => {
    expect(injectionDelta(100_000, 100_000 + CACHE_INJECTION_WARN_TOKENS, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
    expect(injectionDelta(100_000, 104_000, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
  })

  test("negative delta (compaction shrink) → no injection warning", () => {
    expect(injectionDelta(300_000, 100_000, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
  })
})

describe("prefix reset telemetry (P4)", () => {
  test("shrink above threshold → returns shrink size", () => {
    expect(prefixResetDelta(300_000, 100_000, CACHE_INJECTION_WARN_TOKENS)).toBe(200_000)
  })

  test("shrink at/below threshold → undefined", () => {
    expect(prefixResetDelta(100_000 + CACHE_INJECTION_WARN_TOKENS, 100_000, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
    expect(prefixResetDelta(100_000, 200_000, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
  })

  test("no previous total → undefined (cold start)", () => {
    expect(prefixResetDelta(undefined, 100_000, CACHE_INJECTION_WARN_TOKENS)).toBeUndefined()
  })
})

describe("per-step token aggregation (T4)", () => {
  const step = (input: number, read: number, write = 0): StepTokens => ({
    total: input + read + write + 50,
    input,
    output: 25,
    reasoning: 25,
    cache: { read, write },
    cacheRatio: 0,
  })

  test("first step is copied, not shared (no mutation of step parts)", () => {
    const s = step(100, 900)
    const acc = accumulateStepTokens(undefined, s)
    expect(acc).not.toBe(s)
    expect(acc.cache).not.toBe(s.cache)
    expect(acc).toMatchObject({ input: 100, cache: { read: 900 } })
  })

  test("two steps aggregate: input/read/write summed, ratio honest", () => {
    const acc = accumulateStepTokens(accumulateStepTokens(undefined, step(100, 900)), step(200, 1800, 50))
    expect(acc.input).toBe(300)
    expect(acc.cache.read).toBe(2700)
    expect(acc.cache.write).toBe(50)
    // 2700 / (300 + 2700 + 50) = 0.8852...
    expect(acc.cacheRatio).toBeCloseTo(2700 / 3050, 6)
  })

  test("legacy bug contrast: last-step-only would report 0.931, aggregation reports 0.885", () => {
    const acc = accumulateStepTokens(accumulateStepTokens(undefined, step(100, 900)), step(200, 1800, 50))
    const legacyRatio = 2700 / Math.max(1, 200 + 2700 + 50) // input(200)=last step only, read cumulative
    expect(acc.cacheRatio).not.toBeCloseTo(legacyRatio, 4)
    expect(acc.cacheRatio).toBeCloseTo(2700 / 3050, 6)
  })

  test("total accumulates across steps", () => {
    const acc = accumulateStepTokens(accumulateStepTokens(undefined, step(100, 900)), step(200, 1800))
    expect(acc.total).toBe((100 + 900 + 50) + (200 + 1800 + 50))
  })

  test("hit-rate null marker follows the latest observed cache state", () => {
    const unknown = accumulateStepTokens(undefined, step(100, 0), "unknown")
    const hit = accumulateStepTokens(unknown, step(100, 100), "hit")
    const result = accumulateStepTokens(hit, step(100, 0), "miss")
    expect(unknown.cache.hitRateIsNull).toBe(1)
    expect(hit.cache.hitRateIsNull).toBe(0)
    expect(result.cache.hitRateIsNull).toBe(0)
  })
})
