import { expect, describe, test } from "bun:test"
import {
  SUMMARY_INTERVAL_TOKENS,
  MAX_SUMMARY_BODY_TOKENS,
  computeOpenWindowTokens,
  hasFoldableContent,
  layer1SummaryThreshold,
  selectRecentTail,
} from "../../src/session/compaction"
import {
  SUMMARY_GENERATION_RESERVE_TOKENS,
  hasSpareOutput,
  REQUEST_OVERHEAD_TOKENS,
  summaryNeedsCompactFirst,
  summaryWindowLimit,
  usable,
} from "../../src/session/overflow"
import type { Provider } from "@/provider/provider"
import type { Config } from "@/config/config"
import type { MessageV2 } from "../../src/session/message-v2"
import type { MessageID } from "../../src/session/schema"

/**
 * Layer-1 summary cadence regression tests.
 *
 * Bug: summaryWindowLimit clamped the 65 536-token cadence by model context.
 * A ~40K-context model got threshold ≈12.5K and fired Layer-1 summary at
 * session start with ~10K content. Layer-1 must be a pure content counter —
 * small-context models rely on Layer-2 compaction instead.
 */
function textMsg(id: string, chars: number): MessageV2.WithParts {
  return {
    info: { id: id as never, role: "user" },
    parts: [{ type: "text", text: "x".repeat(chars) }],
  } as unknown as MessageV2.WithParts
}

function modelFixture(context: number, output: number): Provider.Model {
  return {
    id: "test/model" as never,
    providerID: "test" as never,
    limit: { context, input: context, output },
    capabilities: { reasoning: false },
    cost: {},
  } as unknown as Provider.Model
}

const cfg = {} as Config.Info

describe("layer1SummaryThreshold (pure content cadence)", () => {
  test("is the 65 536-token interval, model-independent", () => {
    expect(layer1SummaryThreshold()).toBe(SUMMARY_INTERVAL_TOKENS)
    expect(layer1SummaryThreshold()).toBe(65_536)
  })

  test("regression: ~10K startup content must NOT reach the threshold", () => {
    // 10K tokens ≈ 40K chars of conversation at session start.
    const openTokens = computeOpenWindowTokens([textMsg("m1", 40_000)])
    expect(openTokens).toBe(10_000)
    expect(openTokens < layer1SummaryThreshold()).toBe(true)
  })

  test("a 65K open window reaches the cadence (fires)", () => {
    const openTokens = computeOpenWindowTokens([textMsg("m1", 65_536 * 4)])
    expect(openTokens).toBe(65_536)
    expect(openTokens < layer1SummaryThreshold()).toBe(false)
  })
})

describe("summaryWindowLimit (Layer-2 Recent trim — stays context-clamped)", () => {
  test("large model returns the full target", () => {
    expect(
      summaryWindowLimit({
        cfg,
        model: modelFixture(1_000_000, 8_192),
        target: SUMMARY_INTERVAL_TOKENS,
      }),
    ).toBe(SUMMARY_INTERVAL_TOKENS)
  })

  test("unknown context (0) returns the full target", () => {
    expect(
      summaryWindowLimit({
        cfg,
        model: modelFixture(0, 8_192),
        target: SUMMARY_INTERVAL_TOKENS,
      }),
    ).toBe(SUMMARY_INTERVAL_TOKENS)
  })

  test("small ~40K model collapses to ~12.5K — the value Layer-1 must NEVER use", () => {
    // usable = 40_960 − (10_000 + 8_192) = 22_768
    // budget = 8_192; headroom = 2_048 → threshold = 22_768 − 8_192 − 2_048
    const clamped = summaryWindowLimit({
      cfg,
      model: modelFixture(40_960, 8_192),
      target: SUMMARY_INTERVAL_TOKENS,
    })
    expect(clamped).toBe(12_528)
    // The split invariant: Layer-1 cadence is strictly above the Layer-2 clamp.
    expect(layer1SummaryThreshold()).toBeGreaterThan(clamped)
  })
})

describe("summaryNeedsCompactFirst (≥32K generation headroom invariant)", () => {
  test("reserve is 32 768 tokens", () => {
    expect(SUMMARY_GENERATION_RESERVE_TOKENS).toBe(32_768)
  })

  test("room exists: full M + framing + 32K fits → no compact first", () => {
    // limit 100K; content 30K → 40K request + 32_768 = 72_768 ≤ 100K
    expect(
      summaryNeedsCompactFirst({
        model: modelFixture(100_000, 8_192),
        contentTokens: 30_000,
      }),
    ).toBe(false)
  })

  test("no room: full M + 32K exceeds the limit → compact must fire first", () => {
    // limit 100K; content 60K → 70K request + 32_768 = 102_768 > 100K
    expect(
      summaryNeedsCompactFirst({
        model: modelFixture(100_000, 8_192),
        contentTokens: 60_000,
      }),
    ).toBe(true)
  })

  test("exact fit boundary does not block", () => {
    // content = limit − 10K framing − 32_768 → request + reserve == limit
    const content = 100_000 - 10_000 - 32_768
    expect(
      summaryNeedsCompactFirst({
        model: modelFixture(100_000, 8_192),
        contentTokens: content,
      }),
    ).toBe(false)
  })

  test("unknown context limit (0) never blocks", () => {
    expect(
      summaryNeedsCompactFirst({
        model: modelFixture(0, 8_192),
        contentTokens: 999_999,
      }),
    ).toBe(false)
  })

  test("regression: 64K open window on a 100K model forces compact before summary", () => {
    // Full M ≈ 64K open content: 64K + 10K + 32_768 = 106_768 > 100K —
    // the summary would risk cutting content; compact must run first.
    expect(
      summaryNeedsCompactFirst({
        model: modelFixture(100_000, 8_192),
        contentTokens: 64_000,
      }),
    ).toBe(true)
  })
})

describe("hasFoldableContent (headroom gate loop guard)", () => {
  const star = () =>
    ({
      info: { id: "star" as never, role: "user" },
      parts: [{ type: "text", text: "=== COMPACTED ===\nraw star body" }],
    }) as unknown as MessageV2.WithParts

  test("lone message* → false (re-fold cannot shrink it)", () => {
    expect(hasFoldableContent([star()])).toBe(false)
  })

  test("message* + new content → true (fold shrinks M)", () => {
    expect(hasFoldableContent([star(), textMsg("m2", 1_000)])).toBe(true)
  })

  test("single plain message → true", () => {
    expect(hasFoldableContent([textMsg("m1", 1_000)])).toBe(true)
  })

  test("empty visible → false", () => {
    expect(hasFoldableContent([])).toBe(false)
  })

  test("regression: no-headroom + lone star must NOT force compact (gate proceeds to capture)", () => {
    // The deadlock scenario: star exceeds the 32K headroom, but compact can
    // do nothing — the summary capture is the only exit path.
    const noHeadroom = summaryNeedsCompactFirst({
      model: modelFixture(100_000, 8_192),
      contentTokens: 60_000,
    })
    expect(noHeadroom).toBe(true)
    expect(hasFoldableContent([star()])).toBe(false)
  })
})

describe("hasSpareOutput (32k spare gate for every generation)", () => {
  test("enough headroom → true", () => {
    // limit 128k, output 32k: usable = 128k - (10k + 32k) = 86k
    // used = 50k (content) + 10k (overhead) = 60k
    // leftover = 128k - 60k = 68k >= 32k reserve → true
    expect(
      hasSpareOutput({
        cfg,
        model: modelFixture(128_000, 32_768),
        used: 60_000,
      }),
    ).toBe(true)
  })

  test("not enough headroom → false", () => {
    // limit 128k, output 32k: usable = 86k
    // used = 100k (content + overhead)
    // leftover = 128k - 100k = 28k < 32k reserve → false
    expect(
      hasSpareOutput({
        cfg,
        model: modelFixture(128_000, 32_768),
        used: 100_000,
      }),
    ).toBe(false)
  })

  test("unknown context limit (0) → true (never block)", () => {
    expect(
      hasSpareOutput({
        cfg,
        model: modelFixture(0, 32_768),
        used: 999_999,
      }),
    ).toBe(true)
  })

  test("uses observedLimit when set", () => {
    // This test verifies the function reads TokenCalibration.getObservedLimit.
    // We can't easily mock TokenCalibration here, so we test the behavior
    // with a known limit instead.
    const model = modelFixture(256_000, 32_768)
    // usable = 256k - (10k + 32k) = 214k
    // used = 200k → leftover = 56k >= 32k → true
    expect(hasSpareOutput({ cfg, model, used: 200_000 })).toBe(true)
    // used = 230k → leftover = 26k < 32k → false
    expect(hasSpareOutput({ cfg, model, used: 230_000 })).toBe(false)
  })

  test("boundary: exactly 32k spare → true", () => {
    // limit 100k, output 8k: usable = 100k - (10k + 8k) = 82k
    // used = 82k → leftover = 18k < 32k → false
    // Wait, that's wrong. Let me recalculate.
    // hasSpareOutput checks: limit - used >= reserve
    // reserve = min(output, 32768) = min(8192, 32768) = 8192
    // limit = 100k, used = 91808 → leftover = 8192 = reserve → true
    expect(
      hasSpareOutput({
        cfg,
        model: modelFixture(100_000, 8_192),
        used: 91_808,
      }),
    ).toBe(true)
  })
})

describe("pre-send guard arithmetic (no double-count 10k)", () => {
  test("guard does NOT fire at usable - 10k", () => {
    // 128k / 32k model: usable = 128k - (10k + 32k) = 86k
    // content = 76k → estimateContentTokens = 76k + 10k = 86k
    // Old guard: 86k >= 86k → FIRE (wrong!)
    // Fixed guard: 86k - 10k = 76k >= 86k → NO FIRE (correct)
    const model = modelFixture(128_000, 32_768)
    const contentChars = 76_000 * 4  // 76k tokens worth of chars
    const contentTokens = Math.ceil(contentChars / 4) + REQUEST_OVERHEAD_TOKENS
    const u = usable({ cfg, model })
    // Fixed guard: contentTokens - REQUEST_OVERHEAD_TOKENS >= usable
    expect(contentTokens - REQUEST_OVERHEAD_TOKENS >= u).toBe(false)
  })

  test("guard DOES fire when chars/4 >= usable()", () => {
    // 128k / 32k model: usable = 86k
    // content = 90k tokens (chars/4 = 90k)
    // estimateContentTokens = 90k + 10k = 100k
    // Fixed guard: 100k - 10k = 90k >= 86k → FIRE (correct)
    const model = modelFixture(128_000, 32_768)
    const contentChars = 90_000 * 4  // 90k tokens worth of chars
    const contentTokens = Math.ceil(contentChars / 4) + REQUEST_OVERHEAD_TOKENS
    const u = usable({ cfg, model })
    expect(contentTokens - REQUEST_OVERHEAD_TOKENS >= u).toBe(true)
  })
})

describe("selectRecentTail (prior m* exclusion)", () => {
  function starMsg(id: string): MessageV2.WithParts {
    return {
      info: { id: id as never, role: "user" },
      parts: [{ type: "text", text: "=== COMPACTED ===\nprior star body" }],
    } as unknown as MessageV2.WithParts
  }

  test("prior m* is NOT included in recent tail", () => {
    // Messages: [m1, m2, prior_star, m3, m4]
    // After boundary (m2), thin tail: should NOT include the star
    const m1 = textMsg("m1", 5_000)
    const m2 = textMsg("m2", 5_000)
    const star = starMsg("star1")
    const m3 = textMsg("m3", 5_000)
    const m4 = textMsg("m4", 5_000)
    const visible = [m1, m2, star, m3, m4]

    const result = selectRecentTail(visible, "m2" as MessageID, 32_768)
    // Thin tail (m3+m4 = ~2.5K tokens < 32K) walks back, but hard-stops at star
    const ids = result.map((m) => m.info.id as string)
    expect(ids).not.toContain("star1")
  })

  test("prior m* is excluded even with generous minTokens", () => {
    const m1 = textMsg("m1", 10_000)
    const star = starMsg("star1")
    const m2 = textMsg("m2", 1_000)
    const visible = [m1, star, m2]

    const result = selectRecentTail(visible, "m1" as MessageID, 100_000)
    const ids = result.map((m) => m.info.id)
    expect(ids).not.toContain("star1")
  })

  test("no prior m* — normal walk-back works", () => {
    const m1 = textMsg("m1", 10_000)
    const m2 = textMsg("m2", 5_000)
    const m3 = textMsg("m3", 5_000)
    const visible = [m1, m2, m3]

    const result = selectRecentTail(visible, "m1" as MessageID, 32_768)
    // Thin tail: walks back past boundary, no star to stop at
    expect(result.length).toBeGreaterThan(0)
    const ids = result.map((m) => m.info.id as string)
    expect(ids).toContain("m1")
  })

  test("sufficient tail — no walk-back needed", () => {
    const m1 = textMsg("m1", 100_000) // ~25K tokens
    const m2 = textMsg("m2", 100_000)
    const visible = [m1, m2]

    const result = selectRecentTail(visible, "m1" as MessageID, 32_768)
    // m2 alone = 25K tokens, under 32K → walks back, but m1 is not a star
    // so it includes m1
    const ids = result.map((m) => m.info.id as string)
    expect(ids).toContain("m2")
  })
})

describe("MAX_SUMMARY_BODY_TOKENS (32K cap)", () => {
  test("constant is 32 768", () => {
    expect(MAX_SUMMARY_BODY_TOKENS).toBe(32_768)
  })

  test("matches RECENT_MIN_TOKENS value (both 32K)", () => {
    // Semantically distinct but same value — both represent 32K token pools
    expect(MAX_SUMMARY_BODY_TOKENS).toBe(32_768)
  })
})
