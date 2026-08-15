import { expect } from "bun:test"
import { describe, test } from "bun:test"
import { classifyCacheRead, isCacheWarm } from "../../src/session/session"
import { cacheRatio } from "../../src/session/processor"

/**
 * Cache-state classification regression tests.
 *
 * Critical invariant (verified live against vanchin KAT Coder / StreamLake):
 * `cached_tokens: null` (or the field absent) is NOT a cache miss — the
 * gateway simply did not report it. Only an explicit `0` is a real cold miss.
 *
 * The classification MUST run on the RAW `inputTokenDetails.cacheReadTokens`
 * value: `Session.getUsage` collapses null/undefined → 0 for cost math, and
 * `isCacheWarm` on those collapsed tokens would mislabel hits as "cache miss".
 */
describe("classifyCacheRead (tri-state)", () => {
  test("positive read → hit", () => {
    expect(classifyCacheRead(250)).toBe("hit")
  })

  test("explicit zero → miss (real cold request)", () => {
    expect(classifyCacheRead(0)).toBe("miss")
  })

  test("null → unknown, NOT miss (KAT gateway omits field on hits)", () => {
    expect(classifyCacheRead(null)).toBe("unknown")
    expect(classifyCacheRead(null)).not.toBe("miss")
  })

  test("undefined (field absent) → unknown, NOT miss", () => {
    expect(classifyCacheRead(undefined)).toBe("unknown")
    expect(classifyCacheRead(undefined)).not.toBe("miss")
  })
})

describe("collapse trap regression", () => {
  test("null read collapses to 0 downstream — classification must use the RAW value", () => {
    // Mirrors the finish-step path: provider layer maps gateway null → undefined.
    const rawCacheRead: number | undefined = undefined
    // Collapsed tokens (what getUsage produces for cost math):
    const collapsed = { cache: { read: rawCacheRead ?? 0 } }
    // The trap: isCacheWarm on collapsed tokens would say "cold".
    expect(isCacheWarm(collapsed)).toBe(false)
    // The fix: tri-state on the raw value says "unknown" — never "miss".
    expect(classifyCacheRead(rawCacheRead)).toBe("unknown")
    // Explicit 0 stays a true miss.
    expect(classifyCacheRead(0)).toBe("miss")
  })
})

describe("cacheRatio with zero/unknown reads", () => {
  test("read 0 → ratio 0 (no NaN)", () => {
    expect(cacheRatio({ input: 100, cache: { read: 0, write: 0 } })).toBe(0)
  })

  test("all zeros → 0 (no NaN, no division by zero)", () => {
    expect(cacheRatio({ input: 0, cache: { read: 0, write: 0 } })).toBe(0)
  })

  test("normal ratio", () => {
    expect(cacheRatio({ input: 900, cache: { read: 100, write: 0 } })).toBeCloseTo(0.1, 6)
  })
})

describe("isCacheWarm", () => {
  test("read > 0 → warm", () => {
    expect(isCacheWarm({ cache: { read: 1 } })).toBe(true)
  })

  test("read 0 → cold (only valid for explicit zero — unknown must never reach here)", () => {
    expect(isCacheWarm({ cache: { read: 0 } })).toBe(false)
  })
})
