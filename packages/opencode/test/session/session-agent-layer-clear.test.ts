import { describe, expect, test } from "bun:test"
import {
  clearSessionAgentModel,
  clearWorkspaceAgentModel,
  setWorkspaceAgentModel,
} from "../../src/session/session-settings"

describe("releasing an agent layer", () => {
  test("a worktree selection can be released, not only replaced", () => {
    const set = setWorkspaceAgentModel({}, "ws1", "build_mode", {
      providerID: "deepseek",
      modelID: "deepseek-flash",
    })
    expect(set["ws1"]?.["build_mode"]).toBeDefined()
    expect(clearWorkspaceAgentModel(set, "ws1", "build_mode")["ws1"]).toEqual({})
  })

  test("releasing leaves other agents and other workspaces untouched", () => {
    let state = setWorkspaceAgentModel({}, "ws1", "build_mode", { providerID: "a", modelID: "m" })
    state = setWorkspaceAgentModel(state, "ws1", "plan_mode", { providerID: "b", modelID: "n" })
    state = setWorkspaceAgentModel(state, "ws2", "build_mode", { providerID: "c", modelID: "o" })
    const next = clearWorkspaceAgentModel(state, "ws1", "build_mode")
    expect(Object.keys(next["ws1"] ?? {})).toEqual(["plan_mode"])
    expect(next["ws2"]?.["build_mode"]).toEqual({ providerID: "c", modelID: "o" })
  })

  test("clearing an absent agent returns the same object rather than a rewritten one", () => {
    const state = setWorkspaceAgentModel({}, "ws1", "build_mode", { providerID: "a", modelID: "m" })
    expect(clearWorkspaceAgentModel(state, "ws1", "plan_mode")).toBe(state)
    expect(clearWorkspaceAgentModel({}, "ws1", "build_mode")).toEqual({})
  })

  test("a session clear drops model and variant but keeps session-only controls", () => {
    const next = clearSessionAgentModel(
      {
        agent: {
          build_mode: { model: "deepseek/deepseek-flash", variant: "high", routing: { sort: "price" } },
          plan_mode: { model: "groq/qwen/qwen3.6-27b" },
        },
      },
      "build_mode",
    )
    // Routing is a session-only control — clearing a model choice is not a
    // request to discard it.
    expect(next.agent?.["build_mode"]).toEqual({ routing: { sort: "price" } })
    expect(next.agent?.["plan_mode"]).toEqual({ model: "groq/qwen/qwen3.6-27b" })
  })

  test("an entry with nothing left is removed entirely", () => {
    const next = clearSessionAgentModel({ agent: { build_mode: { model: "a/b", variant: "max" } } }, "build_mode")
    expect("build_mode" in (next.agent ?? {})).toBe(false)
  })

  test("clearing an agent that has no override is a no-op", () => {
    expect(clearSessionAgentModel({ agent: {} }, "build_mode").agent).toEqual({})
    expect(clearSessionAgentModel(null, "build_mode").agent).toEqual({})
  })
})
