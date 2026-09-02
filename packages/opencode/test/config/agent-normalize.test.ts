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
})
