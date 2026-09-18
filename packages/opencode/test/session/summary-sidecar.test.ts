import { describe, expect, test } from "bun:test"
import {
  SIDECAR_COOLDOWN_MS,
  SIDECAR_MAX_ATTEMPTS,
  SIDECAR_OUTPUT_TOKEN_MAX,
  isCoolingDown,
  streamOptions,
} from "../../src/session/sidecar-policy"

describe("summary sidecar policy", () => {
  test("caps each request at 32K and never repairs", () => {
    expect(streamOptions()).toEqual({ checkpoint: true, outputTokenMax: 32_768 })
    expect(SIDECAR_OUTPUT_TOKEN_MAX).toBe(32_768)
    // ONE attempt, not two: the forced gap-fill repair was retired on 2026-09-18 —
    // widening the summary template made a four-section body invalid, so every such
    // capture took a SECOND request and could still come back invalid (measured
    // 2026-09-14: an 8_192 budget burned 68 s and ~$0.04 to return `bodyLen: 0`). The
    // draft is now stored as written and its gaps are NAMED for `summaryedit` to fill
    // while the checkpoint is still open. This assertion lagged that change in
    // `db057e7779` and was red until it was caught here.
    expect(SIDECAR_MAX_ATTEMPTS).toBe(1)
  })

  test("cools down failed and successful cycles at the same boundary", () => {
    const end = 1_000_000
    expect(isCoolingDown(undefined, end)).toBe(false)
    expect(isCoolingDown(end, end + SIDECAR_COOLDOWN_MS - 1)).toBe(true)
    expect(isCoolingDown(end, end + SIDECAR_COOLDOWN_MS)).toBe(false)
  })
})
