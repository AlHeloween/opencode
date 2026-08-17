import { expect, test } from "bun:test"
import { canActivateAgent } from "../../src/cli/cmd/tui/util/agent"
import { activeSessionID } from "../../src/cli/cmd/tui/context/local"

const agents = [
  { name: "build_mode", mode: "primary" },
  { name: "explorer_agent", mode: "subagent" },
]

test("TUI does not make a configured subagent the active prompt agent", () => {
  expect(canActivateAgent("explorer_agent", agents)).toBe(false)
  expect(canActivateAgent("build_mode", agents)).toBe(true)
})

test("TUI session settings follow the open session instead of its newest child", () => {
  const sessions = [{ id: "parent" }, { id: "child" }]

  expect(activeSessionID({ type: "session", sessionID: "parent" }, sessions)).toBe("parent")
  expect(activeSessionID({ type: "home" }, sessions)).toBe("child")
})
