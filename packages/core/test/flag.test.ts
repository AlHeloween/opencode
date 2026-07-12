import { afterEach, describe, expect, test } from "bun:test"
import { Flag, resetConfig } from "../src/flag/flag"

describe("feature flags", () => {
  afterEach(() => resetConfig())

  test("experimental Markdown follows config overrides", () => {
    Flag._setTest("OPENCODE_EXPERIMENTAL_MARKDOWN", true)
    expect(Flag.OPENCODE_EXPERIMENTAL_MARKDOWN).toBe(true)

    Flag._setTest("OPENCODE_EXPERIMENTAL_MARKDOWN", false)
    expect(Flag.OPENCODE_EXPERIMENTAL_MARKDOWN).toBe(false)
  })
})
