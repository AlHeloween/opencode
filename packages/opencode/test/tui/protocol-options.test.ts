import { describe, expect, test } from "bun:test"
import { PROTOCOLS, protocolChoices } from "@/cli/cmd/tui/component/protocol-options"

describe("protocol chooser options", () => {
  test("offers h3-first order with http/1.1 last, marked fallback-only", () => {
    expect(PROTOCOLS.map((p) => p.value)).toEqual(["auto", "h3", "h2", "http/1.1"])
    expect(PROTOCOLS[0].description).toContain("h3 first")
    expect(PROTOCOLS[3].description.toLowerCase()).toContain("not recommended")
  })

  test("marks the configured rung and nothing else", () => {
    const choices = protocolChoices("h2")
    expect(choices).toHaveLength(4)
    expect(choices.find((c) => c.value === "h2")?.footer).toBe("configured")
    expect(choices.filter((c) => c.footer !== undefined)).toHaveLength(1)
    expect(protocolChoices("auto")[0].footer).toBe("configured")
    expect(protocolChoices("auto")[1].footer).toBeUndefined()
  })
})
