import { describe, expect, test } from "bun:test"
import {
  SIDECAR_COOLDOWN_MS,
  SIDECAR_MAX_ATTEMPTS,
  isCoolingDown,
  streamOptions,
} from "../../src/session/sidecar-policy"

describe("summary sidecar policy", () => {
  test("inherits the shared budget rule instead of pinning one, and never repairs", () => {
    // Owner ruling 2026-09-19 («для сайдкара тоже самое»): the sidecar no longer carries its own
    // MAX. It inherits `ProviderTransform.maxOutputTokens`, whose 32 768 FLOOR is exactly the value
    // that used to be pinned here, so nothing guaranteed is lost — and the budget now scales with
    // the window instead of disagreeing with what the gate reserves.
    expect(streamOptions()).toEqual({ checkpoint: true })
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
