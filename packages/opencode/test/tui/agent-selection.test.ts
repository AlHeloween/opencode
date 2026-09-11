import { expect, test } from "bun:test"
import { canActivateAgent, shouldActivateAgent } from "../../src/cli/cmd/tui/util/agent"
import { activeSessionID } from "../../src/cli/cmd/tui/context/local"

const agents = [
  { name: "build_mode", mode: "primary" },
  { name: "explorer_agent", mode: "subagent" },
]

test("TUI does not make a configured subagent the active prompt agent", () => {
  expect(canActivateAgent("explorer_agent", agents)).toBe(false)
  expect(canActivateAgent("build_mode", agents)).toBe(true)
})

test("configuring another agent's model from /agents does not move the active agent", () => {
  // /agents passes an explicit target — configuring it must never hijack the prompt.
  expect(shouldActivateAgent("plan_mode", "plan_mode", agents)).toBe(false)
  expect(shouldActivateAgent("build_mode", "build_mode", agents)).toBe(false)
  // /model passes no target — the resolved current agent may still activate.
  expect(shouldActivateAgent("build_mode", undefined, agents)).toBe(true)
  expect(shouldActivateAgent("explorer_agent", undefined, agents)).toBe(false)
})

test("TUI session settings follow the open session instead of its newest child", () => {
  const sessions = [{ id: "parent" }, { id: "child" }]

  expect(activeSessionID({ type: "session", sessionID: "parent" }, sessions)).toBe("parent")
  expect(activeSessionID({ type: "home" }, sessions)).toBe("child")
})
