import { describe, expect, test } from "bun:test"
import { withGlobalAgentModel } from "./global-agent-model"

const agentOf = (cfg: Record<string, unknown>, name: string) =>
  (cfg["agent"] as Record<string, Record<string, string>>)[name]

const base = () => ({ agent: { build: { model: "deepseek/deepseek-chat", variant: "high" }, plan: {} } })

describe("withGlobalAgentModel", () => {
  test("sets the agent model in provider/model spelling", () => {
    const next = withGlobalAgentModel(base(), "plan", { providerID: "opencode", modelID: "big-pickle" }, undefined)
    expect(agentOf(next, "plan")).toEqual({ model: "opencode/big-pickle" })
  })
  test("a variant rides along; null clears it", () => {
    const set = withGlobalAgentModel(base(), "plan", { providerID: "a", modelID: "b" }, "low")
    expect(agentOf(set, "plan")).toEqual({ model: "a/b", variant: "low" })
    const cleared = withGlobalAgentModel(set, "plan", { providerID: "a", modelID: "b" }, null)
    expect(agentOf(cleared, "plan")).toEqual({ model: "a/b" })
  })
  test("other agents and keys survive untouched", () => {
    const next = withGlobalAgentModel({ ...base(), theme: "dark" }, "plan", { providerID: "a", modelID: "b" }, undefined)
    expect(agentOf(next, "build")).toEqual({ model: "deepseek/deepseek-chat", variant: "high" })
    expect(next.theme).toBe("dark")
  })
})
