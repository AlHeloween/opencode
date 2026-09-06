import { describe, expect, test } from "bun:test"
import {
  SIDECAR_COOLDOWN_MS,
  SIDECAR_MAX_ATTEMPTS,
  SIDECAR_OUTPUT_TOKEN_MAX,
  isCoolingDown,
  streamOptions,
} from "../../src/session/sidecar-policy"

describe("summary sidecar policy", () => {
  test("caps each request at 8K and allows only one repair", () => {
    expect(streamOptions()).toEqual({ checkpoint: true, outputTokenMax: 8_192 })
    expect(SIDECAR_OUTPUT_TOKEN_MAX).toBe(8_192)
    expect(SIDECAR_MAX_ATTEMPTS).toBe(2)
  })

  test("cools down failed and successful cycles at the same boundary", () => {
    const end = 1_000_000
    expect(isCoolingDown(undefined, end)).toBe(false)
    expect(isCoolingDown(end, end + SIDECAR_COOLDOWN_MS - 1)).toBe(true)
    expect(isCoolingDown(end, end + SIDECAR_COOLDOWN_MS)).toBe(false)
  })
})
