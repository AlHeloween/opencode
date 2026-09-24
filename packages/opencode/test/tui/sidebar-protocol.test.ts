import { describe, expect, test } from "bun:test"
import { protocolRow } from "@/cli/cmd/tui/feature-plugins/sidebar/protocol-row"

describe("sidebar protocol row", () => {
  test("shows the factual protocol when present", () => {
    expect(protocolRow({ provider: "deepseek", model: "deepseek-flash", protocol: "h2" }, undefined)).toBe("h2")
    expect(protocolRow({ protocol: "h3" }, "http/1.1")).toBe("h3")
  })

  test("falls back to the configured rung, then to the policy value", () => {
    expect(protocolRow(undefined, "h3")).toBe("h3")
    expect(protocolRow(undefined, undefined)).toBe("auto")
  })

  test("NEVER blank — absence of an oracle reads as false (AGENTS.md invariant)", () => {
    expect(protocolRow(undefined, "")).toBe("auto")
    expect(protocolRow({}, "")).toBe("auto")
    expect(protocolRow({ protocol: "" }, "")).toBe("auto")
    expect(protocolRow({ protocol: "" }, undefined)).toBe("auto")
  })
})
