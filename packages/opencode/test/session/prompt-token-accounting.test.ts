import { describe, expect, test } from "bun:test"
import { promptTokensFromUsage } from "@/session/processor"

/**
 * What the overflow gate is actually reasoning about, pinned.
 *
 * `TokenCalibration` was built to correct our chars/4 estimate against the
 * provider's ground truth, and three defects composed to make it inert:
 *
 *   1. `getFactor()` had no caller in src/ — the correction was computed,
 *      EMA-smoothed, logged, and never applied. The factor and its reader were
 *      deleted on 2026-09-19: `update()` now records only the observed context
 *      limit, which `usable()` and `hasSpareOutput` DO consume.
 *   2. `update()` had one call site, inside `halt()` on the
 *      ContextOverflowError branch — it calibrated only on the failure it
 *      exists to prevent, never on the successful turns that carry the same
 *      ground truth.
 *   3. That call passed `assistantMessage.tokens.input` as "our estimate" —
 *      the provider's own count — so factor = provider/provider.
 *
 * Measured over 20 paired requests on 2026-09-15: real/estimate ran 1.46-1.96,
 * median 1.67. The largest single uncounted term is the tool catalog — 98,358
 * chars, ~24,589 tokens, constant on every request, larger than the entire
 * conversation in a fresh session — which `estimateContentTokens(system,
 * messages)` never receives.
 *
 * This file pins (2) and (3)'s input: what "the real prompt size" means.
 * Applying the factor is deliberately NOT done here — it moves when compaction
 * fires, which is a policy decision, not an accounting one.
 */
describe("promptTokensFromUsage — a cached token still occupies context", () => {
  test("all three buckets were in the same prompt", () => {
    expect(promptTokensFromUsage({ input: 1_044, cache: { read: 587_648, write: 0 } })).toBe(588_692)
  })

  test("a cache hit does not shrink the prompt", () => {
    // The trap: `input` alone is what the provider bills at full rate, and
    // reading it as the prompt size understates a 99.7%-cached request by 560x.
    const hit = { input: 1_044, cache: { read: 587_648, write: 0 } }
    expect(promptTokensFromUsage(hit)).toBeGreaterThan(hit.input * 500)
  })

  test("a cache write counts too — those tokens were just sent", () => {
    expect(promptTokensFromUsage({ input: 100, cache: { read: 0, write: 40_000 } })).toBe(40_100)
  })

  test("a cold request is just its input", () => {
    expect(promptTokensFromUsage({ input: 405_144, cache: { read: 0, write: 0 } })).toBe(405_144)
  })

  test("an empty usage yields zero, so the caller can skip calibrating on it", () => {
    expect(promptTokensFromUsage({ input: 0, cache: { read: 0, write: 0 } })).toBe(0)
  })
})
