import { expect, test } from "bun:test"
import { effectiveSubagents } from "../../src/session/session-settings"

test("effectiveSubagents: session override wins over global", () => {
  expect(
    effectiveSubagents("build_mode", ["explorer_agent", "coder_agent"], {
      agent: { build_mode: { subagents: ["explorer_agent"] } },
    }),
  ).toEqual(["explorer_agent"])
})

test("effectiveSubagents: empty session list denies all", () => {
  expect(
    effectiveSubagents("build_mode", ["explorer_agent"], {
      agent: { build_mode: { subagents: [] } },
    }),
  ).toEqual([])
})

test("effectiveSubagents: no session uses global", () => {
  expect(effectiveSubagents("build_mode", ["coder_agent"], null)).toEqual(["coder_agent"])
  expect(effectiveSubagents("build_mode", undefined, null)).toBeUndefined()
})

test("effectiveSubagents: session model-only override does not clear global subagents", () => {
  expect(
    effectiveSubagents("build_mode", ["explorer_agent"], {
      agent: { build_mode: { model: "openai/gpt-4" } },
    }),
  ).toEqual(["explorer_agent"])
})
