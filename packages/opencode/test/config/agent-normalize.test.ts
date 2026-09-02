import { describe, expect, test } from "bun:test"
import { ConfigAgent } from "../../src/config/agent"
import { ConfigParse } from "../../src/config/parse"

// 2026-09-02 (Alexander): an agent block carrying BOTH top-level "routing"
// and options.routing must have ONE defined, observable winner. normalize()
// promotes unknown top-level keys into options, overwriting an explicit
// options.<key> — these tests pin that contract so the winner never becomes
// implementation-accidental.

describe("agent config key shadowing", () => {
  test("top-level unknown key overrides explicit options.<key>", () => {
    const parsed = ConfigParse.effectSchema(
      ConfigAgent.Info,
      {
        name: "build_mode",
        routing: { order: ["novita", "z-ai"] },
        options: { routing: { order: ["NovitaAI"] } },
      },
      "test://opencode.jsonc",
    )
    expect(parsed.options?.routing).toEqual({ order: ["novita", "z-ai"] })
  })

  test("explicit options.<key> survives without a top-level duplicate", () => {
    const parsed = ConfigParse.effectSchema(
      ConfigAgent.Info,
      {
        name: "build_mode",
        options: { routing: { order: ["novita"] } },
      },
      "test://opencode.jsonc",
    )
    expect(parsed.options?.routing).toEqual({ order: ["novita"] })
  })

  test("normalize round-trip is idempotent (decode → json → decode)", () => {
    // The promotion must not grow or shift on re-decode — otherwise repeated
    // config loads (server round-trips, TUI saves) would drift the file.
    const raw = {
      name: "build_mode",
      routing: { order: ["novita", "z-ai"] },
      options: { routing: { order: ["novita", "z-ai"] }, variant: "max" },
    }
    const once = ConfigParse.effectSchema(ConfigAgent.Info, raw, "test://a.jsonc")
    const twice = ConfigParse.effectSchema(ConfigAgent.Info, JSON.parse(JSON.stringify(once)), "test://b.jsonc")
    expect(twice).toEqual(once)
  })
})
