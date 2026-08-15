import { expect, describe, test } from "bun:test"
import {
  SUMMARY_INTERVAL_TOKENS,
  computeOpenWindowTokens,
  hasFoldableContent,
  layer1SummaryThreshold,
} from "../../src/session/compaction"
import {
  SUMMARY_GENERATION_RESERVE_TOKENS,
  summaryNeedsCompactFirst,
  summaryWindowLimit,
} from "../../src/session/overflow"
import type { Provider } from "@/provider/provider"
import type { Config } from "@/config/config"
import type { MessageV2 } from "../../src/session/message-v2"

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
