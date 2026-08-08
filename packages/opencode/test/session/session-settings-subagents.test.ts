import { expect, test } from "bun:test"
import { effectiveSubagents, sessionAgentModel, sessionAgentVariant } from "../../src/session/session-settings"

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

test("sessionAgentModel parses only valid per-agent session overrides", () => {
  expect(sessionAgentModel("plan_mode", { agent: { plan_mode: { model: "openai/gpt-5.6" } } })).toEqual({
    providerID: "openai",
    modelID: "gpt-5.6",
  })
  expect(sessionAgentModel("plan_mode", { agent: { plan_mode: { model: "invalid" } } })).toBeUndefined()
})

test("sessionAgentVariant prioritizes explicit agent selection", () => {
  const model = { providerID: "openai", modelID: "gpt-5.6" }
  expect(
    sessionAgentVariant("plan_mode", model, {
      agent: { plan_mode: { variant: "seeded" } },
      variant: { "openai/gpt-5.6": "model" },
      agentVariant: { "plan_mode/openai/gpt-5.6": "explicit" },
    }),
  ).toBe("explicit")
  expect(
    sessionAgentVariant("plan_mode", model, {
      agent: { plan_mode: { variant: "seeded" } },
      variant: { "openai/gpt-5.6": "model" },
    }),
  ).toBe("seeded")
})
